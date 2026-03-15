import { defineConfig } from "vite";

export default defineConfig({
  assetsInclude: ["**/*.spz", "**/*.glb"],
  server: {
    port: 5000,
    host: "0.0.0.0",
    allowedHosts: true,
  },
  test: {
    environment: "node"
  }
});
