import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const appDirectory = fileURLToPath(new URL("../apps/studio", import.meta.url));
const port = Number(process.env.STUDIO_TEST_PORT || 4319);
const base = `http://127.0.0.1:${port}`;
const dataDirectory = await mkdtemp(join(tmpdir(), "instagram-studio-test-"));
const testEnvironment = {
  ...process.env,
  STUDIO_TEST_URL: base,
  STUDIO_DATA_DIR: dataDirectory,
  // Test fixtures must remain deterministic and cannot make paid provider calls.
  OPENAI_API_KEY: "",
  OPENAI_IMAGE_MODEL: "",
  OPENAI_TEXT_MODEL: "",
  OPENAI_IMAGE_SIZE_FEED: "",
  OPENAI_IMAGE_SIZE_SQUARE: "",
  OPENAI_IMAGE_SIZE_STORY: "",
  STUDIO_DAILY_GENERATION_LIMIT: "20",
  STUDIO_ESTIMATED_GENERATION_COST_USD: "0",
  STUDIO_DAILY_BUDGET_USD: "0",
};
const server = spawn(
  process.execPath,
  [
    require.resolve("next/dist/bin/next"),
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  { cwd: appDirectory, env: testEnvironment, stdio: ["ignore", "pipe", "pipe"] },
);
let logs = "";
server.stdout.on("data", (chunk) => {
  logs = (logs + chunk).slice(-12000);
});
server.stderr.on("data", (chunk) => {
  logs = (logs + chunk).slice(-12000);
});
let serverFailure = null;
server.on("error", (error) => {
  serverFailure = error;
});
const serverExited = new Promise((resolve) => server.on("exit", resolve));
async function runTests(args) {
  const tests = spawn(process.execPath, args, {
    env: testEnvironment,
    stdio: "inherit",
  });
  return await new Promise((resolve, reject) => {
    tests.on("error", reject);
    tests.on("exit", (code) => resolve(code ?? 1));
  });
}
try {
  let ready = false;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (serverFailure) throw serverFailure;
    if (server.exitCode !== null) throw new Error("O aplicativo encerrou antes de iniciar.");
    try {
      const response = await fetch(base + "/api/v1/instagram", {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error("O aplicativo não iniciou em 30 segundos.");
  process.exitCode = await runTests(["--test", "tests/app-smoke.mjs"]);
  if (!process.exitCode) {
    process.exitCode = await runTests([
      require.resolve("@playwright/test/cli"),
      "test",
      "--config",
      "tests/e2e/playwright.config.mjs",
    ]);
  }
  if (!process.exitCode) process.exitCode = await runTests(["--test", "tests/app-recovery.mjs"]);
  if (!process.exitCode)
    process.exitCode = await runTests(["--test", "tests/app-observability.mjs"]);
} catch (error) {
  console.error(error.message);
  console.error(logs);
  process.exitCode = 1;
} finally {
  if (server.exitCode === null && !serverFailure) {
    server.kill("SIGTERM");
    const force = setTimeout(() => server.kill("SIGKILL"), 3000);
    await serverExited;
    clearTimeout(force);
  }
  await rm(dataDirectory, { recursive: true, force: true });
}
