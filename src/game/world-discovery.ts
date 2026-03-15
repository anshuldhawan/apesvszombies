import type { WorldDefinition } from "./types";

export type AssetModuleMap = Record<string, string>;

function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const filename = parts[parts.length - 1] ?? normalized;
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex === -1 ? filename : filename.slice(0, dotIndex);
}

export function formatWorldLabel(id: string): string {
  return id
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/(\d+)/g, " $1")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function createWorldDefinitions(
  spzModules: AssetModuleMap,
  glbModules: AssetModuleMap
): WorldDefinition[] {
  const glbByBase = new Map<string, string>();

  for (const [path, url] of Object.entries(glbModules)) {
    glbByBase.set(basename(path), url);
  }

  return Object.entries(spzModules)
    .map(([path, spzUrl]) => {
      const id = basename(path);
      const collisionGlbUrl = glbByBase.get(id);

      if (!collisionGlbUrl) {
        return null;
      }

      return {
        id,
        label: formatWorldLabel(id),
        spzUrl,
        collisionGlbUrl
      };
    })
    .filter((world): world is WorldDefinition => Boolean(world))
    .sort((left, right) => left.label.localeCompare(right.label));
}
