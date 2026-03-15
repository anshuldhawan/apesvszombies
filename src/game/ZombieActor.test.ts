import { Group, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { ZombieActor } from "./ZombieActor";

describe("ZombieActor.setFacing", () => {
  it("faces the direction the zombie is moving instead of flipping it", () => {
    const zombie = ZombieActor.create(
      {
        scene: new Group(),
        animations: []
      },
      1,
      new Vector3()
    );

    zombie.setFacing(new Vector3(0, 0, 1));

    expect(zombie.root.rotation.y).toBeCloseTo(0);
  });

  it("rotates toward strafing movement consistently", () => {
    const zombie = ZombieActor.create(
      {
        scene: new Group(),
        animations: []
      },
      1,
      new Vector3()
    );

    zombie.setFacing(new Vector3(1, 0, 0));

    expect(zombie.root.rotation.y).toBeCloseTo(Math.PI / 2);
  });
});
