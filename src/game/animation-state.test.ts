import { describe, expect, it } from "vitest";

import { resolveAnimationState } from "./animation-state";

describe("resolveAnimationState", () => {
  it("returns idle by default", () => {
    expect(
      resolveAnimationState({
        isMoving: false,
        isShooting: false,
        isJumping: false,
        isCrouching: false
      })
    ).toBe("idle");
  });

  it("prefers jump over every grounded state", () => {
    expect(
      resolveAnimationState({
        isMoving: true,
        isShooting: true,
        isJumping: true,
        isCrouching: true
      })
    ).toBe("jumping");
  });

  it("uses crouch walk when crouching and moving", () => {
    expect(
      resolveAnimationState({
        isMoving: true,
        isShooting: false,
        isJumping: false,
        isCrouching: true
      })
    ).toBe("crouchWalk");
  });

  it("uses run and shoot when moving and firing", () => {
    expect(
      resolveAnimationState({
        isMoving: true,
        isShooting: true,
        isJumping: false,
        isCrouching: false
      })
    ).toBe("runAndShoot");
  });

  it("uses running when moving without shooting", () => {
    expect(
      resolveAnimationState({
        isMoving: true,
        isShooting: false,
        isJumping: false,
        isCrouching: false
      })
    ).toBe("running");
  });
});
