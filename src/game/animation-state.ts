import type { AnimationState } from "./types";

export interface AnimationInput {
  isMoving: boolean;
  isShooting: boolean;
  isJumping: boolean;
  isCrouching: boolean;
}

export function resolveAnimationState(input: AnimationInput): AnimationState {
  if (input.isCrouching) {
    return "crouchWalk";
  }

  return "runAndShoot";
}
