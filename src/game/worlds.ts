import {
  createWorldDefinitions,
  type AssetModuleMap,
  type WorldDefinitionOverrides
} from "./world-discovery";

const spzModules = import.meta.glob("../../assets/*.spz", {
  eager: true,
  import: "default"
}) as AssetModuleMap;

const glbModules = import.meta.glob("../../assets/*_collider.glb", {
  eager: true,
  import: "default"
}) as AssetModuleMap;

const worldOverrides: WorldDefinitionOverrides = {
  "Times Square city street": {
    spawnOffset: {
      x: -3,
      z: 0
    }
  },
  "Mars Rover Crash Site": {
    initialYaw: Math.PI / 2
  }
};

export const heroModelUrl = new URL("../../assets/firstpersonview.glb", import.meta.url).href;
export const zombieModelUrl = new URL("../../assets/zombie.glb", import.meta.url).href;

export const worldDefinitions = createWorldDefinitions(spzModules, glbModules, worldOverrides);
