import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DATABASE_URL = process.env.DATABASE_URL_TEST || "postgresql://postgres:postgres@localhost:5433/odmtest_pr3?sslmode=disable";

function assertDisposableDatabase(url) {
  const pathname = new URL(url).pathname;
  if (!/^\/(primavera_test|odmtest)/.test(pathname)) {
    throw new Error(`Refusing non-disposable database: ${pathname}`);
  }
}

assertDisposableDatabase(DATABASE_URL);

console.log("Pushing current schema to test database...");

const child = spawn("npx", ["drizzle-kit", "push"], {
  cwd: __dirname + "/..",
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL },
});

child.on("exit", (code) => {
  process.exitCode = code ?? 0;
});
