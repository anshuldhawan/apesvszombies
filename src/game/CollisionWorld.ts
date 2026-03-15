import {
  Box3,
  BufferGeometry,
  Line3,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Raycaster,
  Vector3
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree
} from "three-mesh-bvh";

import { planSpawnPoints } from "./spawn-logic";
import type { WorldSpawnOffset } from "./types";

(BufferGeometry.prototype as BufferGeometry & {
  computeBoundsTree?: typeof computeBoundsTree;
  disposeBoundsTree?: typeof disposeBoundsTree;
}).computeBoundsTree = computeBoundsTree;

(BufferGeometry.prototype as BufferGeometry & {
  computeBoundsTree?: typeof computeBoundsTree;
  disposeBoundsTree?: typeof disposeBoundsTree;
}).disposeBoundsTree = disposeBoundsTree;

(Mesh.prototype as Mesh).raycast = acceleratedRaycast;

const DOWN = new Vector3(0, -1, 0);
const UP = new Vector3(0, 1, 0);
const FALLBACK_SPAWN_HEIGHT = 6;

type BVHGeometry = BufferGeometry & {
  computeBoundsTree: () => void;
};

function cloneWorldGeometry(root: Mesh): BufferGeometry {
  const geometry = root.geometry.clone();
  geometry.applyMatrix4(root.matrixWorld);
  return geometry;
}

export interface RayHit {
  point: Vector3;
  distance: number;
}

export interface RandomSpawnOptions {
  minDistanceFromPlayer: number;
  minDistanceBetweenPoints: number;
  sampleAttempts: number;
  rng?: () => number;
}

export class CollisionWorld {
  readonly mesh: Mesh;
  readonly bounds: Box3;
  readonly rootPosition: Vector3;
  readonly rootQuaternion: Quaternion;
  readonly rootScale: Vector3;

  private readonly segment = new Line3();
  private readonly capsuleBounds = new Box3();
  private readonly trianglePoint = new Vector3();
  private readonly capsulePoint = new Vector3();
  private readonly correction = new Vector3();

  private constructor(
    mesh: Mesh,
    bounds: Box3,
    rootPosition: Vector3,
    rootQuaternion: Quaternion,
    rootScale: Vector3
  ) {
    this.mesh = mesh;
    this.bounds = bounds;
    this.rootPosition = rootPosition;
    this.rootQuaternion = rootQuaternion;
    this.rootScale = rootScale;
  }

  static async load(url: string): Promise<CollisionWorld> {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url);
    gltf.scene.updateWorldMatrix(true, true);

    const rootPosition = new Vector3();
    const rootQuaternion = new Quaternion();
    const rootScale = new Vector3();
    gltf.scene.matrixWorld.decompose(rootPosition, rootQuaternion, rootScale);

    const meshes: BufferGeometry[] = [];
    gltf.scene.traverse((object) => {
      if (!(object instanceof Mesh)) {
        return;
      }

      meshes.push(cloneWorldGeometry(object));
    });

    if (meshes.length === 0) {
      throw new Error("The selected world GLB does not contain a mesh.");
    }

    const merged = (meshes.length === 1 ? meshes[0] : mergeGeometries(meshes, true)) as
      | BufferGeometry
      | null;

    if (!merged) {
      throw new Error("Failed to build the collision mesh for this world.");
    }

    merged.computeBoundingBox();
    (merged as BVHGeometry).computeBoundsTree();

    const mesh = new Mesh(merged, new MeshBasicMaterial({ visible: false }));
    mesh.visible = false;
    mesh.updateMatrixWorld(true);

    return new CollisionWorld(
      mesh,
      merged.boundingBox?.clone() ?? new Box3(),
      rootPosition,
      rootQuaternion,
      rootScale
    );
  }

  destroy(): void {
    this.mesh.geometry.dispose();
  }

  getSpawnPoint(playerHeight: number, offset?: WorldSpawnOffset): Vector3 {
    const center = this.bounds.getCenter(new Vector3());
    const x = center.x + (offset?.x ?? 0);
    const z = center.z + (offset?.z ?? 0);
    const y = offset?.y ?? 0;
    const hit = this.projectPointToGround(x, z);

    if (hit) {
      hit.y += y;
      return hit;
    }

    return new Vector3(x, this.bounds.max.y + playerHeight + y, z);
  }

  getRandomSpawnPoints(
    count: number,
    playerPosition: Vector3,
    options: RandomSpawnOptions
  ): Vector3[] {
    const center = this.bounds.getCenter(new Vector3());

    return planSpawnPoints({
      count,
      bounds: {
        minX: this.bounds.min.x,
        maxX: this.bounds.max.x,
        minZ: this.bounds.min.z,
        maxZ: this.bounds.max.z,
        centerX: center.x,
        centerZ: center.z
      },
      playerPosition,
      minDistanceFromPlayer: options.minDistanceFromPlayer,
      minDistanceBetweenPoints: options.minDistanceBetweenPoints,
      sampleAttempts: options.sampleAttempts,
      rng: options.rng,
      projectPoint: (x, z) => this.projectPointToGround(x, z)
    }).map((point) => new Vector3(point.x, point.y, point.z));
  }

  raycast(origin: Vector3, direction: Vector3, maxDistance: number): RayHit | null {
    const raycaster = new Raycaster(origin, direction.clone().normalize(), 0, maxDistance);
    (raycaster as Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;

    const hit = raycaster.intersectObject(this.mesh, false)[0];
    if (!hit) {
      return null;
    }

    return {
      point: hit.point.clone(),
      distance: hit.distance
    };
  }

  intersectsCapsule(position: Vector3, height: number, radius: number): boolean {
    const boundsTree = this.mesh.geometry.boundsTree;
    if (!boundsTree) {
      return false;
    }

    this.buildCapsule(position, height, radius);

    let intersects = false;
    boundsTree.shapecast({
      intersectsBounds: (box) => box.intersectsBox(this.capsuleBounds),
      intersectsTriangle: (triangle) => {
        const distance = triangle.closestPointToSegment(
          this.segment,
          this.trianglePoint,
          this.capsulePoint
        );

        if (distance < radius) {
          intersects = true;
          return true;
        }

        return false;
      }
    });

    return intersects;
  }

  resolveCapsule(
    position: Vector3,
    height: number,
    radius: number,
    verticalDisplacement: number
  ): { position: Vector3; grounded: boolean } {
    const boundsTree = this.mesh.geometry.boundsTree;

    if (!boundsTree) {
      return { position, grounded: false };
    }

    const originalPosition = position.clone();
    this.buildCapsule(position, height, radius);

    boundsTree.shapecast({
      intersectsBounds: (box) => box.intersectsBox(this.capsuleBounds),
      intersectsTriangle: (triangle) => {
        const distance = triangle.closestPointToSegment(
          this.segment,
          this.trianglePoint,
          this.capsulePoint
        );

        if (distance >= radius) {
          return false;
        }

        const depth = radius - distance;
        this.correction.subVectors(this.capsulePoint, this.trianglePoint);

        if (this.correction.lengthSq() === 0) {
          triangle.getNormal(this.correction);
        } else {
          this.correction.normalize();
        }

        this.segment.start.addScaledVector(this.correction, depth);
        this.segment.end.addScaledVector(this.correction, depth);

        this.capsuleBounds.makeEmpty();
        this.capsuleBounds.expandByPoint(this.segment.start);
        this.capsuleBounds.expandByPoint(this.segment.end);
        this.capsuleBounds.min.addScalar(-radius);
        this.capsuleBounds.max.addScalar(radius);

        return false;
      }
    });

    const correctedPosition = new Vector3(
      this.segment.start.x,
      this.segment.start.y - radius,
      this.segment.start.z
    );

    const offset = correctedPosition.clone().sub(originalPosition);
    const grounded =
      offset.y > Math.max(0.001, Math.abs(verticalDisplacement) * 0.35) && verticalDisplacement <= 0;

    return {
      position: correctedPosition,
      grounded
    };
  }

  private buildCapsule(position: Vector3, height: number, radius: number): void {
    this.segment.start.set(position.x, position.y + radius, position.z);
    this.segment.end.set(position.x, position.y + Math.max(radius, height - radius), position.z);
    this.capsuleBounds.makeEmpty();
    this.capsuleBounds.expandByPoint(this.segment.start);
    this.capsuleBounds.expandByPoint(this.segment.end);
    this.capsuleBounds.min.addScalar(-radius);
    this.capsuleBounds.max.addScalar(radius);
  }

  private projectPointToGround(x: number, z: number): Vector3 | null {
    const start = new Vector3(x, this.bounds.max.y + FALLBACK_SPAWN_HEIGHT, z);
    const hit = this.raycast(start, DOWN, this.bounds.max.y - this.bounds.min.y + 30);

    if (!hit) {
      return null;
    }

    return hit.point.addScaledVector(UP, 0.05);
  }
}
