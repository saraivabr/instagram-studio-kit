import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const appDirectory = fileURLToPath(new URL("../apps/studio", import.meta.url));
const port = Number(process.env.STUDIO_TEST_PORT || 4319);
const base = `http://127.0.0.1:${port}`;
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
  { cwd: appDirectory, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
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
try {
  let ready = false;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (serverFailure) throw serverFailure;
    if (server.exitCode !== null)
      throw new Error("O aplicativo encerrou antes de iniciar.");
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
  const tests = spawn(process.execPath, ["--test", "tests/app-smoke.mjs"], {
    env: { ...process.env, STUDIO_TEST_URL: base },
    stdio: "inherit",
  });
  const code = await new Promise((resolve, reject) => {
    tests.on("error", reject);
    tests.on("exit", resolve);
  });
  process.exitCode = code ?? 1;
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
}
