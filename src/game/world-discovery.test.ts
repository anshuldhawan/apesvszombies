import { describe, expect, it } from "vitest";

import { createWorldDefinitions, formatWorldLabel } from "./world-discovery";

describe("createWorldDefinitions", () => {
  it("pairs only matching spz and glb assets", () => {
    const worlds = createWorldDefinitions(
      {
        "../../assets/urbanmap.spz": "/urbanmap.spz",
        "../../assets/urbanmap2.spz": "/urbanmap2.spz",
        "../../assets/unmatched.spz": "/unmatched.spz"
      },
      {
        "../../assets/urbanmap.glb": "/urbanmap.glb",
        "../../assets/urbanmap2.glb": "/urbanmap2.glb",
        "../../assets/ape.glb": "/ape.glb"
      }
    );

    expect(worlds).toEqual([
      {
        id: "urbanmap",
        label: "Urbanmap",
        spzUrl: "/urbanmap.spz",
        collisionGlbUrl: "/urbanmap.glb"
      },
      {
        id: "urbanmap2",
        label: "Urbanmap 2",
        spzUrl: "/urbanmap2.spz",
        collisionGlbUrl: "/urbanmap2.glb"
      }
    ]);
  });
});

describe("formatWorldLabel", () => {
  it("turns filenames into readable labels", () => {
    expect(formatWorldLabel("city-block_07")).toBe("City Block 07");
  });
});
