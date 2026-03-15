import {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  Box3,
  Group,
  LoopRepeat,
  Mesh,
  Raycaster,
  Vector3
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";

import { applyBulletDamage, ZOMBIE_STARTING_HEALTH } from "./combat";
import type { ZombieMode, ZombieState } from "./types";

export const ZOMBIE_TARGET_HEIGHT = 1.15;
const ZOMBIE_FACING_OFFSET = Math.PI;

export interface ZombieTemplate {
  scene: Group;
  animations: AnimationClip[];
}

const CLIP_MAP: Record<ZombieMode, string> = {
  chasing: "Running",
  attacking: "Attack"
};

export class ZombieActor {
  readonly root: Group;
  readonly state: ZombieState;

  private readonly mixer: AnimationMixer;
  private readonly actions = new Map<ZombieMode, AnimationAction>();
  private currentMode: ZombieMode | null = null;

  private constructor(root: Group, mixer: AnimationMixer, state: ZombieState) {
    this.root = root;
    this.mixer = mixer;
    this.state = state;
  }

  static async loadTemplate(modelUrl: string): Promise<ZombieTemplate> {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(modelUrl);
    const scene = gltf.scene;
    scene.updateMatrixWorld(true);

    const size = new Box3().setFromObject(scene).getSize(new Vector3());
    const scale = size.y > 0 ? ZOMBIE_TARGET_HEIGHT / size.y : 1;
    scene.scale.setScalar(scale);
    scene.updateMatrixWorld(true);

    const bounds = new Box3().setFromObject(scene);
    scene.position.y -= bounds.min.y;
    scene.updateMatrixWorld(true);

    return {
      scene,
      animations: gltf.animations
    };
  }

  static create(template: ZombieTemplate, id: number, position: Vector3): ZombieActor {
    const root = new Group();
    const scene = clone(template.scene) as Group;
    root.add(scene);
    root.position.copy(position);

    const mixer = new AnimationMixer(scene);
    const actor = new ZombieActor(root, mixer, {
      id,
      health: ZOMBIE_STARTING_HEALTH,
      attackCooldown: 0,
      alive: true,
      position: root.position,
      velocity: new Vector3(),
      mode: "chasing"
    });

    actor.bindClips(template.animations);
    actor.setMode("chasing");

    return actor;
  }

  destroy(): void {
    this.root.removeFromParent();
    this.mixer.stopAllAction();
  }

  setMode(mode: ZombieMode): void {
    this.state.mode = mode;

    if (mode === this.currentMode) {
      return;
    }

    const currentAction = this.currentMode ? this.actions.get(this.currentMode) : undefined;
    const nextAction = this.actions.get(mode);

    currentAction?.fadeOut(0.14);

    if (nextAction) {
      nextAction
        .reset()
        .setLoop(LoopRepeat, Infinity)
        .setEffectiveWeight(1)
        .fadeIn(0.14)
        .play();
    }

    this.currentMode = mode;
  }

  setFacing(direction: Vector3): void {
    if (direction.lengthSq() === 0) {
      return;
    }

    this.root.rotation.y = Math.atan2(direction.x, direction.z) + ZOMBIE_FACING_OFFSET;
  }

  update(deltaSeconds: number): void {
    this.mixer.update(deltaSeconds);
  }

  raycast(raycaster: Raycaster) {
    if (!this.state.alive) {
      return null;
    }

    return raycaster.intersectObject(this.root, true)[0] ?? null;
  }

  applyDamage(damage: number): { killed: boolean; scoreDelta: number } {
    const result = applyBulletDamage(this.state.health, damage);
    this.state.health = result.nextHealth;
    this.state.alive = result.alive;

    if (result.killed) {
      this.destroy();
    }

    return {
      killed: result.killed,
      scoreDelta: result.scoreDelta
    };
  }

  private bindClips(clips: AnimationClip[]): void {
    for (const [mode, clipName] of Object.entries(CLIP_MAP) as Array<
      [ZombieMode, string]
    >) {
      const clip =
        clips.find((candidate) => candidate.name === clipName) ??
        (mode === "chasing"
          ? clips.find((candidate) => candidate.name === "Walking")
          : undefined);

      if (!clip) {
        continue;
      }

      const action = this.mixer.clipAction(clip);
      action.enabled = true;
      action.setEffectiveWeight(0);
      action.play();
      this.actions.set(mode, action);
    }
  }
}
