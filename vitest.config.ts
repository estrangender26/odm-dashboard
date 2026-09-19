import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "src"),
      "@contracts": path.resolve(templateRoot, "contracts"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
      "@db": path.resolve(templateRoot, "db"),
      "@db/": `${path.resolve(templateRoot, "db")}/`,
      "@lihok/project-controls/testing": path.resolve(templateRoot, "packages/project-controls/src/testing.ts"),
      "@lihok/project-controls": path.resolve(templateRoot, "packages/project-controls/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["api/**/*.test.ts", "api/**/*.spec.ts", "src/**/*.test.ts", "src/**/*.spec.ts", "src/**/*.test.tsx", "src/**/*.spec.tsx", "packages/**/*.test.ts"],
  },
});
