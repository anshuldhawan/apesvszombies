export interface SpawnPointLike {
  x: number;
  y: number;
  z: number;
}

export interface SpawnBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  centerX: number;
  centerZ: number;
}

export interface SpawnPlannerOptions {
  count: number;
  bounds: SpawnBounds;
  playerPosition: SpawnPointLike;
  minDistanceFromPlayer: number;
  minDistanceBetweenPoints: number;
  sampleAttempts: number;
  projectPoint: (x: number, z: number) => SpawnPointLike | null;
  rng?: () => number;
}

const FALLBACK_RING_STEPS = 24;
const MAX_FALLBACK_RINGS = 8;

function distanceSquaredXZ(left: SpawnPointLike, right: SpawnPointLike): number {
  const dx = left.x - right.x;
  const dz = left.z - right.z;
  return dx * dx + dz * dz;
}

function withinBounds(point: SpawnPointLike, bounds: SpawnBounds): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.z >= bounds.minZ &&
    point.z <= bounds.maxZ
  );
}

function canUsePoint(
  point: SpawnPointLike,
  accepted: SpawnPointLike[],
  playerPosition: SpawnPointLike,
  minDistanceFromPlayer: number,
  minDistanceBetweenPoints: number
): boolean {
  if (distanceSquaredXZ(point, playerPosition) < minDistanceFromPlayer * minDistanceFromPlayer) {
    return false;
  }

  return accepted.every(
    (acceptedPoint) =>
      distanceSquaredXZ(point, acceptedPoint) >=
      minDistanceBetweenPoints * minDistanceBetweenPoints
  );
}

function sampleCandidate(bounds: SpawnBounds, rng: () => number): { x: number; z: number } {
  return {
    x: bounds.minX + (bounds.maxX - bounds.minX) * rng(),
    z: bounds.minZ + (bounds.maxZ - bounds.minZ) * rng()
  };
}

export function planSpawnPoints(options: SpawnPlannerOptions): SpawnPointLike[] {
  const rng = options.rng ?? Math.random;
  const accepted: SpawnPointLike[] = [];

  for (let attempt = 0; attempt < options.sampleAttempts && accepted.length < options.count; attempt += 1) {
    const candidate = sampleCandidate(options.bounds, rng);
    const projected = options.projectPoint(candidate.x, candidate.z);

    if (
      projected &&
      withinBounds(projected, options.bounds) &&
      canUsePoint(
        projected,
        accepted,
        options.playerPosition,
        options.minDistanceFromPlayer,
        options.minDistanceBetweenPoints
      )
    ) {
      accepted.push(projected);
    }
  }

  const width = options.bounds.maxX - options.bounds.minX;
  const depth = options.bounds.maxZ - options.bounds.minZ;
  const baseRadius = Math.max(
    options.minDistanceFromPlayer + 0.5,
    Math.min(width, depth) * 0.18
  );

  for (
    let ring = 0;
    ring < MAX_FALLBACK_RINGS && accepted.length < options.count;
    ring += 1
  ) {
    const radius = baseRadius + ring * options.minDistanceBetweenPoints * 1.8;

    for (
      let step = 0;
      step < FALLBACK_RING_STEPS && accepted.length < options.count;
      step += 1
    ) {
      const angle = (step / FALLBACK_RING_STEPS) * Math.PI * 2 + ring * 0.21;
      const x = options.bounds.centerX + Math.cos(angle) * radius;
      const z = options.bounds.centerZ + Math.sin(angle) * radius;
      const projected = options.projectPoint(x, z);

      if (
        projected &&
        withinBounds(projected, options.bounds) &&
        canUsePoint(
          projected,
          accepted,
          options.playerPosition,
          options.minDistanceFromPlayer,
          options.minDistanceBetweenPoints
        )
      ) {
        accepted.push(projected);
      }
    }
  }

  return accepted;
}
