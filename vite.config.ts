import { defineConfig } from "vite";

export default defineConfig({
  assetsInclude: ["**/*.spz", "**/*.glb"],
  test: {
    environment: "node"
  }
});
