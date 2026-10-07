import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);
const appDirectory = fileURLToPath(new URL("../apps/studio", import.meta.url));
const port = Number(process.env.STUDIO_TEST_PORT || 4319) + 2;
const base = `http://127.0.0.1:${port}`;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function diagnosticChain(error) {
  const chain = [];
  let current = error;
  while (current && typeof current === "object" && chain.length < 10) {
    chain.push(current);
    current = current.cause;
  }
  return chain;
}

function events(logs) {
  return logs.split(/\r?\n/).flatMap((line) => {
    try {
      const value = JSON.parse(line);
      return value && typeof value === "object" && value.event ? [value] : [];
    } catch {
      return [];
    }
  });
}

test(
  "storage failures retain safe diagnostics, bounded logs and worker recovery",
  { timeout: 120000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "instagram-studio-observability-"));
    const privatePrefix = "AUDIT_PRIVATE";
    const marker = "AUDIT_PRIVATE_CONTENT_DO_NOT_LOG";
    const contents = `{"private":"${marker}","broken":}`;
    const legacyPath = join(directory, "items.json");
    let logs = "";
    let serverFailure;
    let server;
    let serverExited;
    let verification;
    try {
      await writeFile(legacyPath, contents);
      server = spawn(
        process.execPath,
        [
          require.resolve("next/dist/bin/next"),
          "start",
          "--hostname",
          "127.0.0.1",
          "--port",
          String(port),
        ],
        {
          cwd: appDirectory,
          env: {
            ...process.env,
            STUDIO_DATA_DIR: directory,
            // A corruption probe must never make paid provider requests.
            OPENAI_API_KEY: "",
            OPENAI_IMAGE_MODEL: "",
            OPENAI_TEXT_MODEL: "",
            OPENAI_IMAGE_SIZE_FEED: "",
            OPENAI_IMAGE_SIZE_SQUARE: "",
            OPENAI_IMAGE_SIZE_STORY: "",
            STUDIO_DAILY_GENERATION_LIMIT: "20",
            STUDIO_ESTIMATED_GENERATION_COST_USD: "0",
            STUDIO_DAILY_BUDGET_USD: "0",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const collect = (chunk) => {
        logs = (logs + chunk.toString()).slice(-1_000_000);
      };
      server.stdout.on("data", collect);
      server.stderr.on("data", collect);
      server.on("error", (error) => {
        serverFailure = error;
      });
      serverExited = new Promise((resolve) => server.once("exit", resolve));
      let ready = false;
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        if (serverFailure) throw serverFailure;
        if (server.exitCode !== null)
          throw new Error(`Servidor encerrou antes da prontidão: código ${server.exitCode}`);
        try {
          // Readiness does not touch the intentionally corrupt repository.
          const response = await fetch(`${base}/favicon.svg`, {
            signal: AbortSignal.timeout(1000),
          });
          if (response.ok) {
            ready = true;
            break;
          }
        } catch {}
        await pause(200);
      }
      assert.equal(ready, true, "Servidor não iniciou em 30 segundos");

      const response = await fetch(`${base}/api/v1/instagram`, {
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(response.status, 500);
      const payload = await response.json();
      const requestId = response.headers.get("x-request-id");
      assert.match(requestId, /^[a-f0-9-]{36}$/i);
      assert.equal(payload.error.request_id, requestId);
      assert.equal(payload.error.code, "internal_error");
      assert.equal("stack" in payload.error, false, "Stack traces stay in server logs");
      assert.equal("cause" in payload.error, false, "Internal causes stay in server logs");

      const diagnosticDeadline = Date.now() + 5000;
      let requestEvent;
      let workerEvent;
      while (Date.now() < diagnosticDeadline) {
        const captured = events(logs);
        requestEvent = captured.find(
          (event) => event.event === "studio_request_failed" && event.request_id === requestId,
        );
        workerEvent = captured.find((event) => event.event === "studio_worker_failed");
        if (requestEvent && workerEvent) break;
        await pause(50);
      }
      assert.ok(requestEvent, "The response ID must correlate to a structured server log");
      assert.equal(requestEvent.status, 500);
      for (const event of [requestEvent, workerEvent]) {
        assert.ok(event, "Both the request handler and background worker report the failure");
        const chain = diagnosticChain(event.error);
        assert.ok(chain.length >= 2, "The original cause must survive its storage wrapper");
        for (const error of chain) {
          assert.equal(typeof error.name, "string");
          assert.equal(typeof error.message, "string");
          assert.equal(typeof error.stack, "string");
          assert.ok(error.stack.length > 0, "The server retains the failure location");
        }
        const diagnostic = JSON.stringify(chain);
        assert.ok(/items\.json/i.test(diagnostic), "The diagnostic identifies items.json");
        assert.ok(/migr[aã]|legacy/i.test(diagnostic), "The diagnostic identifies migration");
        assert.ok(chain.some((error) => error.name === "SyntaxError"));
      }

      const pageResponse = await fetch(`${base}/app/instagram/new`, {
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(pageResponse.status, 500);
      const pageBody = await pageResponse.text();
      for (const privateText of [marker, privatePrefix])
        assert.equal(
          pageBody.includes(privateText),
          false,
          "SSR responses keep storage contents private",
        );

      // Verify observable behavior over the audit's original 30-second failure window.
      await pause(30000);
      const workerEvents = events(logs).filter((event) => event.event === "studio_worker_failed");
      assert.ok(workerEvents.length >= 1);
      assert.ok(
        workerEvents.length <= 5,
        `Persistent corruption produced ${workerEvents.length} worker logs in 30 seconds`,
      );
      for (const privateText of [marker, privatePrefix]) {
        assert.equal(
          logs.includes(privateText),
          false,
          "Repository contents must not leak through JSON errors or SSR fallback logs",
        );
        assert.equal(JSON.stringify(payload).includes(privateText), false);
      }
      assert.ok(
        (await readFile(legacyPath, "utf8")) === contents,
        "Corrupt source remains recoverable",
      );

      // Correcting storage should let the existing process resume its queued work.
      await writeFile(legacyPath, "{}");
      const id = randomUUID();
      const created = await fetch(`${base}/api/v1/instagram`, {
        method: "POST",
        headers: { Origin: base, "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          kind: "post",
          brief: "Criação simulada após recuperar o armazenamento local.",
          niche: "Serviços",
          format: "feed",
          use_logo: false,
        }),
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(created.status, 202);
      const recoveryDeadline = Date.now() + 30000;
      let recovered;
      while (Date.now() < recoveryDeadline) {
        const detail = await fetch(`${base}/api/v1/instagram/${id}`, {
          signal: AbortSignal.timeout(5000),
        });
        assert.equal(detail.status, 200);
        const value = (await detail.json()).data;
        if (value.status !== "generating") {
          recovered = value;
          break;
        }
        await pause(200);
      }
      assert.ok(recovered, "The backed-off worker resumes without restarting the server");
      assert.equal(recovered.status, "ready", "The recovered demo item completes successfully");
      for (const privateText of [marker, privatePrefix])
        assert.equal(logs.includes(privateText), false);
      verification = {
        event: "observability_verified",
        worker_logs_in_30s: workerEvents.length,
        request_id_correlated: true,
        storage_recovered: true,
      };
    } finally {
      if (server && server.exitCode === null && !serverFailure) {
        server.kill("SIGTERM");
        const force = setTimeout(() => server.kill("SIGKILL"), 3000);
        await serverExited;
        clearTimeout(force);
      }
      await rm(directory, { recursive: true, force: true });
    }
    console.info(JSON.stringify(verification));
  },
);
