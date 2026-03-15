import { describe, expect, it } from "vitest";

import { createWorldDefinitions, formatWorldLabel } from "./world-discovery";

describe("createWorldDefinitions", () => {
  it("pairs matching spz assets with exact or collider glbs", () => {
    const worlds = createWorldDefinitions(
      {
        "../../assets/urbanmap.spz": "/urbanmap.spz",
        "../../assets/Times Square city street.spz": "/times-square.spz",
        "../../assets/Industrial Base on Alien Planet.spz": "/industrial-base.spz",
        "../../assets/unmatched.spz": "/unmatched.spz"
      },
      {
        "../../assets/urbanmap.glb": "/urbanmap.glb",
        "../../assets/Times Square city street_collider.glb": "/times-square-collider.glb",
        "../../assets/Industrial Base on Alien Planet.glb": "/industrial-base.glb",
        "../../assets/Industrial Base on Alien Planet_collider.glb":
          "/industrial-base-collider.glb",
        "../../assets/ape.glb": "/ape.glb"
      },
      {
        "Times Square city street": {
          initialYaw: Math.PI / 2,
          spawnOffset: {
            x: -3,
            z: 0
          }
        }
      }
    );

    expect(worlds).toEqual([
      {
        id: "Industrial Base on Alien Planet",
        label: "Industrial Base On Alien Planet",
        spzUrl: "/industrial-base.spz",
        collisionGlbUrl: "/industrial-base-collider.glb",
        source: "preset"
      },
      {
        id: "Times Square city street",
        label: "Times Square City Street",
        spzUrl: "/times-square.spz",
        collisionGlbUrl: "/times-square-collider.glb",
        source: "preset",
        initialYaw: Math.PI / 2,
        spawnOffset: {
          x: -3,
          z: 0
        }
      },
      {
        id: "urbanmap",
        label: "Urbanmap",
        spzUrl: "/urbanmap.spz",
        collisionGlbUrl: "/urbanmap.glb",
        source: "preset"
      }
    ]);
  });
});

describe("formatWorldLabel", () => {
  it("turns filenames into readable labels", () => {
    expect(formatWorldLabel("city-block_07")).toBe("City Block 07");
  });
});
