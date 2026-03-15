import { describe, expect, it } from "vitest";

import { resolveAnimationState } from "./animation-state";

describe("resolveAnimationState", () => {
  it("returns run and shoot by default", () => {
    expect(
      resolveAnimationState({
        isMoving: false,
        isShooting: false,
        isJumping: false,
        isCrouching: false
      })
    ).toBe("runAndShoot");
  });

  it("keeps run and shoot while airborne", () => {
    expect(
      resolveAnimationState({
        isMoving: true,
        isShooting: true,
        isJumping: true,
        isCrouching: false
      })
    ).toBe("runAndShoot");
  });

  it("uses crouch walk when crouching without movement", () => {
    expect(
      resolveAnimationState({
        isMoving: false,
        isShooting: false,
        isJumping: false,
        isCrouching: true
      })
    ).toBe("crouchWalk");
  });

  it("keeps crouch walk over shooting and jumping", () => {
    expect(
      resolveAnimationState({
        isMoving: true,
        isShooting: true,
        isJumping: true,
        isCrouching: true
      })
    ).toBe("crouchWalk");
  });

  it("keeps run and shoot while moving without firing", () => {
    expect(
      resolveAnimationState({
        isMoving: true,
        isShooting: false,
        isJumping: false,
        isCrouching: false
      })
    ).toBe("runAndShoot");
  });
});
