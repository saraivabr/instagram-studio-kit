import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
const require = createRequire(new URL("../apps/studio/package.json", import.meta.url));
const directory = join(process.env.STUDIO_DATA_DIR, "recovery");
const port = Number(process.env.STUDIO_TEST_PORT || 4319) + 1;
const base = `http://127.0.0.1:${port}`;
let server;
let logs = "";
const request = (path, method = "GET", body) =>
  fetch(base + path, {
    method,
    headers: { Origin: base, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
async function stop(signal = "SIGTERM") {
  if (!server || server.exitCode !== null) return;
  const child = server;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill(signal);
  const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
  await exited;
  clearTimeout(timer);
}
async function boot(overrides = {}) {
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
      cwd: fileURLToPath(new URL("../apps/studio", import.meta.url)),
      env: {
        ...process.env,
        STUDIO_DATA_DIR: directory,
        STUDIO_DAILY_GENERATION_LIMIT: "20",
        STUDIO_DAILY_BUDGET_USD: "0",
        STUDIO_ESTIMATED_GENERATION_COST_USD: "0",
        ZERNIO_API_KEY: "",
        ZERNIO_PROFILE_ID: "",
        ...overrides,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stdout.on("data", (chunk) => {
    logs = (logs + chunk).slice(-4000);
  });
  server.stderr.on("data", (chunk) => {
    logs = (logs + chunk).slice(-4000);
  });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Servidor encerrou: ${logs}`);
    try {
      if ((await request("/api/v1/instagram/config")).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Servidor não iniciou: ${logs}`);
}
const input = (id) => ({
  id,
  kind: "post",
  brief: "Recuperação de uma criação persistida na fila.",
  niche: "Serviços",
  format: "feed",
  use_logo: false,
});
const item = (id, status = "generating") => ({
  id,
  kind: "post",
  status,
  input: input(id),
  caption: "",
  answer: "",
  sources: [],
  asset_path: null,
  error: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});
async function ready(id, status = "ready", timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const response = await request(`/api/v1/instagram/${id}`);
    assert.equal(response.status, 200);
    const value = (await response.json()).data;
    if (value.status !== "generating") {
      assert.equal(value.status, status, value.error);
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Fila persistida não concluiu");
}
test("legacy migration, restart recovery, ambiguous jobs and transactional quotas", async () => {
  await mkdir(join(directory, "local"), { recursive: true });
  const originalId = randomUUID().toUpperCase();
  const interrupted = randomUUID();
  const original = { ...item(originalId, "ready"), asset_path: `local/${originalId}.png` };
  const unfinished = item(interrupted);
  // A carousel slide stored as square before 0.6.0 must not stop the store from opening.
  const squareSlide = randomUUID();
  const legacySlide = item(squareSlide, "ready");
  legacySlide.input = {
    ...legacySlide.input,
    format: "square",
    carousel: { id: randomUUID(), template: "noticia_impacto_operacional", slide: 1 },
  };
  const legacy = JSON.stringify({
    [JSON.stringify(["local", originalId])]: original,
    [JSON.stringify(["local", interrupted])]: unfinished,
    [JSON.stringify(["local", squareSlide])]: legacySlide,
  });
  await writeFile(join(directory, "items.json"), legacy);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jh+kAAAAASUVORK5CYII=",
    "base64",
  );
  await writeFile(join(directory, "local", `${originalId}.png`), png);
  try {
    await boot();
    const migrated = (await (await request(`/api/v1/instagram/${originalId}`)).json()).data;
    assert.equal(migrated.id, originalId.toLowerCase());
    assert.equal((await request(`/api/assets/${originalId}`)).status, 200);
    assert.equal((await ready(interrupted, "failed")).status, "failed");
    const slide = (await (await request(`/api/v1/instagram/${squareSlide}`)).json()).data;
    assert.equal(slide.input.format, "feed", "legacy carousel slides migrate as feed");
    assert.equal(await readFile(join(directory, "items.pre-sqlite.json"), "utf8"), legacy);
    const queued = randomUUID();
    const recent = randomUUID();
    const stale = randomUUID();
    const db = new DatabaseSync(join(directory, "studio.sqlite"));
    // The worker released this job but could not save the item's failure.
    const orphan = randomUUID();
    for (const [id, state, started] of [
      [queued, "queued", null],
      [recent, "running", new Date().toISOString()],
      [stale, "running", new Date(Date.now() - 11 * 60_000).toISOString()],
      [orphan, "failed", new Date().toISOString()],
    ]) {
      const value = item(id);
      db.prepare(
        "INSERT INTO items(tenant,id,kind,status,created_at,value) VALUES(?,?,?,?,?,?)",
      ).run("local", id, "post", "generating", value.created_at, JSON.stringify(value));
      db.prepare(
        "INSERT INTO jobs(id,tenant,item_id,state,context,created_at,started_at) VALUES(?,?,?,?,?,?,?)",
      ).run(
        randomUUID(),
        "local",
        id,
        state,
        JSON.stringify({ name: "Sua empresa" }),
        value.created_at,
        started,
      );
    }
    // The same UUID in another tenant cannot be exposed by the authenticated local adapter.
    const privateItem = item(randomUUID(), "ready");
    db.prepare("INSERT INTO items(tenant,id,kind,status,created_at,value) VALUES(?,?,?,?,?,?)").run(
      "other-tenant",
      privateItem.id,
      "post",
      "ready",
      privateItem.created_at,
      JSON.stringify(privateItem),
    );
    db.close();
    const newId = randomUUID();
    assert.equal((await request("/api/v1/instagram", "POST", input(newId))).status, 202);
    const beforeCrash = (await (await request(`/api/v1/instagram/${recent}`)).json()).data;
    assert.equal(
      beforeCrash.status,
      "generating",
      "Repeated worker startup must not interrupt a current process job",
    );
    await stop("SIGKILL");
    await boot();
    const interruptedRecent = await ready(recent, "failed", 10000);
    assert.match(interruptedRecent.error, /interrompida.*provedor.*cobrada/i);
    const resumed = await ready(queued, "ready", 10000);
    await ready(newId, "ready", 10000);
    await ready(stale, "failed", 10000);
    const recoveredOrphan = await ready(orphan, "failed", 10000);
    assert.equal(recoveredOrphan.can_retry, true, "an orphaned item can be retried again");
    const recoveredDb = new DatabaseSync(join(directory, "studio.sqlite"));
    assert.equal(
      recoveredDb.prepare("SELECT state FROM jobs WHERE item_id=?").get(recent).state,
      "failed",
    );
    assert.equal(
      recoveredDb.prepare("SELECT COUNT(*) AS count FROM jobs WHERE item_id=?").get(recent).count,
      1,
      "An interrupted intent must not be requeued automatically",
    );
    recoveredDb.close();
    assert.equal((await request(`/api/v1/instagram/${privateItem.id}`)).status, 404);
    const timestamp = (await stat(join(directory, resumed.asset_path))).mtimeMs;
    const retry = await request(`/api/v1/instagram/${stale}/retry`, "POST");
    assert.equal(retry.status, 202);
    await ready((await retry.json()).data.id);
    await stop();
    await boot({ STUDIO_DAILY_GENERATION_LIMIT: "2" });
    assert.equal(
      (await stat(join(directory, resumed.asset_path))).mtimeMs,
      timestamp,
      "A completed paid intent must not generate again after restart",
    );
    const blockedId = randomUUID();
    assert.equal((await request("/api/v1/instagram", "POST", input(blockedId))).status, 429);
    assert.equal((await request(`/api/v1/instagram/${blockedId}`)).status, 404);
    assert.equal(
      (
        await request("/api/v1/instagram", "POST", {
          id: randomUUID(),
          kind: "reference",
          username: "example",
        })
      ).status,
      200,
      "Free references remain available after generation quota",
    );
    await stop();
    await boot({ STUDIO_DAILY_BUDGET_USD: "0.1", STUDIO_ESTIMATED_GENERATION_COST_USD: "0.1" });
    const budgetId = randomUUID();
    assert.equal((await request("/api/v1/instagram", "POST", input(budgetId))).status, 202);
    await ready(budgetId);
    assert.equal((await request("/api/v1/instagram", "POST", input(randomUUID()))).status, 429);
    const checked = new DatabaseSync(join(directory, "studio.sqlite"));
    assert.equal(checked.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    checked.close();
  } finally {
    await stop();
  }
});
