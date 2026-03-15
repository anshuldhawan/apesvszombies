import { Box3, Group, Object3D, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export interface CharacterPoseInput {
  isMoving: boolean;
  isShooting: boolean;
  isJumping: boolean;
  isCrouching: boolean;
}

const FIRST_PERSON_VIEW_LAYER = 1;
const FIRST_PERSON_VIEW_SCALE = 0.45;
const FIRST_PERSON_VIEW_X = 0.32;
const FIRST_PERSON_VIEW_Y = -0.26;
const FIRST_PERSON_VIEW_Z = -0.82;

interface CharacterAnimatorOptions {
  modelUrl: string;
}

export class CharacterAnimator {
  readonly root: Group;

  private constructor(root: Group) {
    this.root = root;
  }

  static async load(options: CharacterAnimatorOptions): Promise<CharacterAnimator> {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(options.modelUrl);
    const root = new Group();
    const scene = gltf.scene;
    const bounds = new Box3().setFromObject(scene);
    const center = bounds.getCenter(new Vector3());

    scene.position.copy(center).multiplyScalar(-1);
    scene.updateMatrixWorld(true);
    scene.traverse((object) => {
      object.layers.set(FIRST_PERSON_VIEW_LAYER);
      object.renderOrder = 10;
      if ("frustumCulled" in object) {
        object.frustumCulled = false;
      }
    });

    root.position.set(FIRST_PERSON_VIEW_X, FIRST_PERSON_VIEW_Y, FIRST_PERSON_VIEW_Z);
    root.scale.setScalar(FIRST_PERSON_VIEW_SCALE);
    root.add(scene);

    return new CharacterAnimator(root);
  }

  update(_deltaSeconds: number): void {}

  setYaw(_yaw: number): void {}

  getHeadOffset(target: Vector3): Vector3 {
    return target.set(0, 0, 0);
  }

  getViewReference(target: Vector3): Vector3 {
    return target.set(0, 0, 0);
  }

  setPose(_input: CharacterPoseInput): void {}
}

export function getHeroLayer(): number {
  return FIRST_PERSON_VIEW_LAYER;
}

export function getWorldYaw(object: Object3D): number {
  object.updateMatrixWorld(true);
  const worldDirection = new Vector3();
  object.getWorldDirection(worldDirection);
  return Math.atan2(worldDirection.x, worldDirection.z);
}
