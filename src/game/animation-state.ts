import type { AnimationState } from "./types";

export interface AnimationInput {
  isMoving: boolean;
  isShooting: boolean;
  isJumping: boolean;
  isCrouching: boolean;
}

export function resolveAnimationState(input: AnimationInput): AnimationState {
  if (input.isJumping) {
    return "jumping";
  }

  if (input.isCrouching && input.isMoving) {
    return "crouchWalk";
  }

  if (input.isMoving && input.isShooting) {
    return "runAndShoot";
  }

  if (input.isMoving) {
    return "running";
  }

  return "idle";
}
