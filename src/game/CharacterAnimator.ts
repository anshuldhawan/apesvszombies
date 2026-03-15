import {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  Box3,
  Group,
  LoopOnce,
  LoopRepeat,
  Object3D,
  Vector3
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import { resolveAnimationState } from "./animation-state";
import type { AnimationState } from "./types";

const TARGET_MODEL_HEIGHT = 1.02;
const HERO_LAYER = 1;

const CLIP_MAP: Record<AnimationState, string> = {
  idle: "Walking",
  running: "Running",
  runAndShoot: "Run_and_Shoot",
  jumping: "Regular_Jump",
  crouchWalk: "Crouch_Walk_Left_with_Gun_inplace"
};

interface CharacterAnimatorOptions {
  modelUrl: string;
}

export interface CharacterPoseInput {
  isMoving: boolean;
  isShooting: boolean;
  isJumping: boolean;
  isCrouching: boolean;
}

export class CharacterAnimator {
  readonly root: Group;

  private readonly mixer: AnimationMixer;
  private readonly actions = new Map<AnimationState, AnimationAction>();
  private readonly headAnchor: Object3D | null;
  private readonly viewAnchor: Object3D | null;
  private readonly headReference = new Vector3();
  private readonly viewReference = new Vector3();
  private readonly headWorld = new Vector3();
  private readonly headLocal = new Vector3();
  private readonly viewWorld = new Vector3();
  private readonly viewLocal = new Vector3();
  private currentState: AnimationState = "idle";

  private constructor(
    root: Group,
    mixer: AnimationMixer,
    headAnchor: Object3D | null,
    viewAnchor: Object3D | null
  ) {
    this.root = root;
    this.mixer = mixer;
    this.headAnchor = headAnchor;
    this.viewAnchor = viewAnchor;
  }

  static async load(options: CharacterAnimatorOptions): Promise<CharacterAnimator> {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(options.modelUrl);

    const root = new Group();
    const scene = gltf.scene;
    scene.updateMatrixWorld(true);

    const size = new Box3().setFromObject(scene).getSize(new Vector3());
    const scale = size.y > 0 ? TARGET_MODEL_HEIGHT / size.y : 1;
    scene.scale.setScalar(scale);
    scene.updateMatrixWorld(true);

    const bounds = new Box3().setFromObject(scene);
    scene.position.y -= bounds.min.y;
    scene.updateMatrixWorld(true);

    scene.traverse((object) => {
      object.layers.set(HERO_LAYER);
    });

    root.add(scene);

    const mixer = new AnimationMixer(scene);
    const headAnchor =
      scene.getObjectByName("Head") ??
      scene.getObjectByName("headfront") ??
      scene.getObjectByName("head_end") ??
      null;
    const viewAnchor = scene.getObjectByName("headfront") ?? headAnchor;
    const animator = new CharacterAnimator(root, mixer, headAnchor, viewAnchor);
    animator.bindClips(gltf.animations);
    animator.setPose({
      isMoving: false,
      isShooting: false,
      isJumping: false,
      isCrouching: false
    });
    animator.update(0);
    animator.captureHeadReference();
    animator.captureViewReference();

    return animator;
  }

  update(deltaSeconds: number): void {
    this.mixer.update(deltaSeconds);
  }

  setYaw(yaw: number): void {
    this.root.rotation.y = yaw;
  }

  getHeadOffset(target: Vector3): Vector3 {
    if (!this.headAnchor) {
      return target.set(0, 0, 0);
    }

    this.root.updateWorldMatrix(true, true);
    this.headAnchor.getWorldPosition(this.headWorld);
    this.headLocal.copy(this.headWorld);
    this.root.worldToLocal(this.headLocal);

    return target.copy(this.headLocal).sub(this.headReference);
  }

  getViewReference(target: Vector3): Vector3 {
    return target.copy(this.viewReference);
  }

  setPose(input: CharacterPoseInput): void {
    const nextState = resolveAnimationState(input);

    if (nextState === this.currentState) {
      if (nextState === "idle") {
        this.holdIdlePose();
      }

      return;
    }

    const nextAction = this.actions.get(nextState);
    const previousAction = this.actions.get(this.currentState);

    if (!nextAction) {
      return;
    }

    if (previousAction && previousAction !== nextAction) {
      previousAction.fadeOut(0.14);
      previousAction.paused = false;
      previousAction.enabled = true;
    }

    nextAction.enabled = true;
    nextAction.reset();
    nextAction.paused = false;
    nextAction.setEffectiveTimeScale(1);
    nextAction.setEffectiveWeight(1);
    nextAction.fadeIn(0.14);
    nextAction.play();

    if (nextState === "jumping") {
      nextAction.setLoop(LoopOnce, 1);
      nextAction.clampWhenFinished = true;
    } else {
      nextAction.setLoop(LoopRepeat, Infinity);
      nextAction.clampWhenFinished = false;
    }

    this.currentState = nextState;

    if (nextState === "idle") {
      this.holdIdlePose();
    }
  }

  private bindClips(clips: AnimationClip[]): void {
    for (const [state, clipName] of Object.entries(CLIP_MAP) as Array<
      [AnimationState, string]
    >) {
      const clip = clips.find((candidate) => candidate.name === clipName);

      if (!clip) {
        continue;
      }

      const action = this.mixer.clipAction(clip);
      action.enabled = true;
      action.setEffectiveWeight(0);
      action.play();
      this.actions.set(state, action);
    }
  }

  private holdIdlePose(): void {
    const idleAction = this.actions.get("idle");

    if (!idleAction) {
      return;
    }

    idleAction.paused = true;
    idleAction.time = 0;
    idleAction.setEffectiveWeight(1);
  }

  private captureHeadReference(): void {
    if (!this.headAnchor) {
      return;
    }

    this.root.updateWorldMatrix(true, true);
    this.headAnchor.getWorldPosition(this.headWorld);
    this.headReference.copy(this.headWorld);
    this.root.worldToLocal(this.headReference);
  }

  private captureViewReference(): void {
    if (!this.viewAnchor) {
      this.viewReference.set(0, 0, 0);
      return;
    }

    this.root.updateWorldMatrix(true, true);
    this.viewAnchor.getWorldPosition(this.viewWorld);
    this.viewReference.copy(this.viewWorld);
    this.root.worldToLocal(this.viewReference);
  }
}

export function getHeroLayer(): number {
  return HERO_LAYER;
}

export function getWorldYaw(object: Object3D): number {
  object.updateMatrixWorld(true);
  const worldDirection = new Vector3();
  object.getWorldDirection(worldDirection);
  return Math.atan2(worldDirection.x, worldDirection.z);
}
