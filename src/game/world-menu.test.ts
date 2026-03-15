import { describe, expect, it } from "vitest";

import type { WorldDefinition } from "./types";
import { buildMenuWorlds, rememberGeneratedWorld } from "./world-menu";

function createWorld(id: string, source: WorldDefinition["source"]): WorldDefinition {
  return {
    id,
    label: id,
    spzUrl: `/${id}.spz`,
    collisionGlbUrl: `/${id}.glb`,
    source
  };
}

describe("buildMenuWorlds", () => {
  it("keeps generated worlds first while preserving preset worlds", () => {
    const worlds = buildMenuWorlds(
      [createWorld("preset-a", "preset"), createWorld("preset-b", "preset")],
      [createWorld("generated-new", "generated"), createWorld("generated-old", "generated")]
    );

    expect(worlds.map((world) => world.id)).toEqual([
      "generated-new",
      "generated-old",
      "preset-a",
      "preset-b"
    ]);
  });
});

describe("rememberGeneratedWorld", () => {
  it("prepends the newest generated world and replaces older copies", () => {
    const previous = [
      createWorld("generated-old", "generated"),
      createWorld("generated-new", "generated")
    ];

    const updated = rememberGeneratedWorld(previous, {
      ...createWorld("generated-new", "generated"),
      label: "Updated Generated World"
    });

    expect(updated).toEqual([
      {
        id: "generated-new",
        label: "Updated Generated World",
        spzUrl: "/generated-new.spz",
        collisionGlbUrl: "/generated-new.glb",
        source: "generated"
      },
      createWorld("generated-old", "generated")
    ]);
  });
});
