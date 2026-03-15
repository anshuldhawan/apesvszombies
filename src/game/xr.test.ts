import { describe, expect, it } from "vitest";

import {
  applyXrAxisDeadzone,
  createUncheckedXrSessionState,
  deriveXrActionState,
  getInitialXrSessionState
} from "./xr";

describe("createUncheckedXrSessionState", () => {
  it("starts in an unchecked state before support probing completes", () => {
    expect(createUncheckedXrSessionState()).toEqual({
      checked: false,
      supported: false,
      canEnter: false,
      isPresenting: false,
      status: "unsupported",
      message: null
    });
  });
});

describe("getInitialXrSessionState", () => {
  it("reports secure-context requirements before browser support", () => {
    expect(
      getInitialXrSessionState({
        hasNavigatorXr: true,
        isSecureContext: false
      })
    ).toMatchObject({
      checked: true,
      supported: false,
      canEnter: false,
      status: "unsupported"
    });
  });

  it("marks immersive VR as available when support exists", () => {
    expect(
      getInitialXrSessionState({
        hasNavigatorXr: true,
        isSecureContext: true
      })
    ).toEqual({
      checked: true,
      supported: true,
      canEnter: true,
      isPresenting: false,
      status: "available",
      message: null
    });
  });
});

describe("applyXrAxisDeadzone", () => {
  it("drops values that stay inside the deadzone", () => {
    expect(applyXrAxisDeadzone(0.1, 0.2)).toBe(0);
  });

  it("rescales values once they leave the deadzone", () => {
    expect(applyXrAxisDeadzone(0.6, 0.2)).toBeCloseTo(0.5);
    expect(applyXrAxisDeadzone(-0.6, 0.2)).toBeCloseTo(-0.5);
  });
});

describe("deriveXrActionState", () => {
  it("maps left-hand locomotion and jump from the strongest stick pair", () => {
    expect(
      deriveXrActionState([
        {
          handedness: "left",
          axes: [0, 0, 0.4, -0.7],
          buttons: [
            { pressed: false },
            { pressed: false },
            { pressed: false },
            { pressed: false },
            { pressed: true }
          ]
        }
      ])
    ).toMatchObject({
      hasLeftController: true,
      hasRightController: false,
      jumpPressed: true
    });
  });

  it("maps right-hand turning and shooting", () => {
    const state = deriveXrActionState([
      {
        handedness: "right",
        axes: [0.55, 0.05],
        buttons: [{ pressed: true }]
      }
    ]);

    expect(state.hasRightController).toBe(true);
    expect(state.shootPressed).toBe(true);
    expect(state.turnX).toBeLessThan(0);
  });
});
