import type { Vector3 } from "three";

export interface WorldSpawnOffset {
  x: number;
  z: number;
  y?: number;
}

export interface WorldDefinition {
  id: string;
  label: string;
  spzUrl: string;
  collisionGlbUrl: string;
  source: "preset" | "generated";
  worldLabsId?: string;
  promptText?: string;
  worldMarbleUrl?: string;
  thumbnailUrl?: string;
  initialYaw?: number;
  spawnOffset?: WorldSpawnOffset;
}

export interface SessionState {
  playerText: string;
  selectedWorldId: string | null;
}

export type XrSessionStatus =
  | "unsupported"
  | "available"
  | "entering"
  | "presenting"
  | "error";

export interface XrSessionState {
  checked: boolean;
  supported: boolean;
  canEnter: boolean;
  isPresenting: boolean;
  status: XrSessionStatus;
  message: string | null;
}

export type AppState =
  | { kind: "menu" }
  | { kind: "requesting"; location: string; statusMessage: string }
  | { kind: "polling"; location: string; statusMessage: string; operationId: string | null }
  | { kind: "loading"; world: WorldDefinition }
  | { kind: "playing"; world: WorldDefinition };

export type AnimationState =
  | "idle"
  | "running"
  | "runAndShoot"
  | "jumping"
  | "crouchWalk";

export interface CombatHudState {
  playerHealth: number;
  score: number;
  zombiesRemaining: number;
  gameOver: boolean;
}

export type ZombieMode = "chasing" | "attacking";

export interface ZombieState {
  id: number;
  health: number;
  attackCooldown: number;
  alive: boolean;
  position: Vector3;
  velocity: Vector3;
  mode: ZombieMode;
}
