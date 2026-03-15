import { describe, expect, it } from "vitest";

import { MAX_LOOK_PITCH, stepLookPitch, toGameKey } from "./controls";

describe("toGameKey", () => {
  it("maps both option keys to shoot", () => {
    expect(toGameKey("AltLeft")).toBe("Shoot");
    expect(toGameKey("AltRight")).toBe("Shoot");
  });

  it("ignores unrelated keys", () => {
    expect(toGameKey("KeyQ")).toBeNull();
  });
});

describe("stepLookPitch", () => {
  it("clamps the look pitch at the upper bound", () => {
    expect(stepLookPitch(MAX_LOOK_PITCH - 0.02, 1, 0.1, 1)).toBe(MAX_LOOK_PITCH);
  });

  it("clamps the look pitch at the lower bound", () => {
    expect(stepLookPitch(-MAX_LOOK_PITCH + 0.02, -1, 0.1, 1)).toBe(-MAX_LOOK_PITCH);
  });
});
