import type { WorldDefinition } from "./types";

export function buildMenuWorlds(
  presetWorlds: readonly WorldDefinition[],
  generatedWorlds: readonly WorldDefinition[]
): WorldDefinition[] {
  return [...generatedWorlds, ...presetWorlds];
}

export function rememberGeneratedWorld(
  existingWorlds: readonly WorldDefinition[],
  nextWorld: WorldDefinition
): WorldDefinition[] {
  return [nextWorld, ...existingWorlds.filter((world) => world.id !== nextWorld.id)];
}
