/**
 * Template path resolution for both source and built distributions.
 *
 * In development the templates live under
 * src/modules/executive-presentations/templates. The build script copies them
 * to dist/templates so production can resolve them from the bundled app root.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export const EXECUTIVE_TEMPLATES_DIR = "src/modules/executive-presentations/templates";

export type ExecutiveTemplateName =
  | "ExecutiveMaster.pptx"
  | "MonthlyKpiExecutive.pptx"
  | "GovernanceExecutive.pptx";

function candidatePaths(filename: string, importMetaUrl: string): string[] {
  const thisFile = fileURLToPath(importMetaUrl);
  const candidates: string[] = [];

  // Source generator layout:
  //   src/modules/executive-presentations/generators/*.ts
  //   -> two parent directories reach executive-presentations/templates
  candidates.push(
    path.resolve(thisFile, "..", "..", "templates", filename)
  );

  // Source framework layout:
  //   src/modules/executive-presentations/framework/*.ts
  //   -> one parent directory reaches executive-presentations/templates
  candidates.push(
    path.resolve(thisFile, "..", "templates", filename)
  );

  // Cwd-based fallbacks (used by vitest and when import.meta.url is bundled).
  candidates.push(
    path.resolve(process.cwd(), EXECUTIVE_TEMPLATES_DIR, filename)
  );
  candidates.push(path.resolve(process.cwd(), "dist/templates", filename));

  return candidates;
}

export function resolveExecutiveTemplatePath(
  filename: ExecutiveTemplateName,
  importMetaUrl = import.meta.url
): string {
  const candidates = candidatePaths(filename, importMetaUrl);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(
    `[EXECUTIVE TEMPLATE] Template not found: ${filename}. ` +
      `Searched:\n${candidates.map((c) => `  - ${c}`).join("\n")}. ` +
      `Ensure the build copies ${EXECUTIVE_TEMPLATES_DIR} to dist/templates.`
  );
}
