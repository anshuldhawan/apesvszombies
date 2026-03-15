import { createWorldDefinitions, type AssetModuleMap } from "./world-discovery";

const spzModules = import.meta.glob("../../assets/*.spz", {
  eager: true,
  import: "default"
}) as AssetModuleMap;

const glbModules = import.meta.glob("../../assets/*_collider.glb", {
  eager: true,
  import: "default"
}) as AssetModuleMap;

export const heroModelUrl = new URL("../../assets/firstpersonview.glb", import.meta.url).href;
export const zombieModelUrl = new URL("../../assets/zombie.glb", import.meta.url).href;

export const worldDefinitions = createWorldDefinitions(spzModules, glbModules);
