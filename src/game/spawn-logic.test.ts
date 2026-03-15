import { describe, expect, it } from "vitest";

import { planSpawnPoints } from "./spawn-logic";

describe("planSpawnPoints", () => {
  it("uses deterministic sampling while respecting player and zombie spacing", () => {
    const rngValues = [0.5, 0.5, 0.9, 0.1, 0.8, 0.2, 0.2, 0.8, 0.75, 0.75];
    let rngIndex = 0;

    const points = planSpawnPoints({
      count: 3,
      bounds: {
        minX: -10,
        maxX: 10,
        minZ: -10,
        maxZ: 10,
        centerX: 0,
        centerZ: 0
      },
      playerPosition: { x: 0, y: 0, z: 0 },
      minDistanceFromPlayer: 6,
      minDistanceBetweenPoints: 1.5,
      sampleAttempts: 5,
      rng: () => rngValues[rngIndex++] ?? 0.1,
      projectPoint: (x, z) =>
        x >= -10 && x <= 10 && z >= -10 && z <= 10 ? { x, y: 0, z } : null
    });

    expect(points).toHaveLength(3);
    for (const point of points) {
      expect(Math.hypot(point.x, point.z)).toBeGreaterThanOrEqual(6);
    }
  });

  it("falls back to a deterministic ring when random attempts fail", () => {
    const points = planSpawnPoints({
      count: 4,
      bounds: {
        minX: -12,
        maxX: 12,
        minZ: -12,
        maxZ: 12,
        centerX: 0,
        centerZ: 0
      },
      playerPosition: { x: 0, y: 0, z: 0 },
      minDistanceFromPlayer: 6,
      minDistanceBetweenPoints: 1.5,
      sampleAttempts: 2,
      rng: () => 0.5,
      projectPoint: (x, z) =>
        x >= -12 && x <= 12 && z >= -12 && z <= 12 ? { x, y: 0, z } : null
    });

    expect(points).toHaveLength(4);
    const uniqueSpots = new Set(points.map((point) => `${point.x.toFixed(2)}:${point.z.toFixed(2)}`));
    expect(uniqueSpots.size).toBe(4);
    for (const point of points) {
      expect(Math.hypot(point.x, point.z)).toBeGreaterThanOrEqual(6);
    }
  });
});
