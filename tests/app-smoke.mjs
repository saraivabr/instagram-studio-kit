import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import sharp from "sharp";
const base = process.env.STUDIO_TEST_URL || "http://127.0.0.1:4319";
const request = (path, method = "GET", body, origin = base) =>
  fetch(base + path, {
    method,
    headers: { Origin: origin, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const input = () => ({
  id: randomUUID(),
  kind: "post",
  brief: "Demonstração de integração do estúdio.",
  niche: "Serviços",
  format: "feed",
});
async function ready(id) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const response = await request(`/api/v1/instagram/${id}`);
    assert.equal(response.status, 200);
    const item = (await response.json()).data;
    if (item.status !== "generating") {
      assert.equal(item.status, "ready", item.error);
      return item;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Geração não terminou");
}
test("async intent is idempotent, normalized, cropped, editable and has a real thumbnail", async () => {
  const body = input();
  const first = await request("/api/v1/instagram", "POST", { ...body, id: body.id.toUpperCase() });
  assert.equal(first.status, 202);
  assert.equal((await first.json()).data.id, body.id);
  const repeat = await request("/api/v1/instagram", "POST", body);
  assert.equal((await repeat.json()).data.id, body.id);
  const item = await ready(body.id);
  assert.ok(item.asset_path);
  const edited = await request(`/api/v1/instagram/${body.id}`, "PATCH", {
    caption: "Legenda verificada",
  });
  assert.equal((await edited.json()).data.caption, "Legenda verificada");
  const asset = await request(`/api/assets/${body.id.toUpperCase()}`);
  assert.equal(asset.headers.get("content-type"), "image/png");
  const bytes = Buffer.from(await asset.arrayBuffer());
  const meta = await sharp(bytes).metadata();
  assert.equal(meta.width, 1024);
  assert.equal(meta.height, 1280);
  const thumbnail = await request(`/api/assets/${body.id}?thumbnail=1`);
  const thumb = Buffer.from(await thumbnail.arrayBuffer());
  assert.equal(thumbnail.headers.get("content-type"), "image/webp");
  assert.ok(thumb.length < bytes.length);
  assert.equal((await sharp(thumb).metadata()).width, 320);
  const other = {
    ...input(),
    brief: "Uma ideia diferente precisa aparecer na arte de demonstração.",
  };
  await request("/api/v1/instagram", "POST", other);
  await ready(other.id);
  const secondBytes = await (await request(`/api/assets/${other.id}`)).arrayBuffer();
  assert.notEqual(
    createHash("sha256").update(bytes).digest("hex"),
    createHash("sha256").update(Buffer.from(secondBytes)).digest("hex"),
  );
});
test("precise validation, body limits, method allowlist, origins and nested paths", async () => {
  assert.equal(
    (await request("/api/v1/instagram", "POST", input(), "https://untrusted.example")).status,
    403,
  );
  const bad = await request("/api/v1/instagram", "POST", {
    ...input(),
    organization_id: "foreign",
  });
  assert.equal(bad.status, 400);
  assert.ok((await bad.json()).error.fields.length);
  const malformed = await fetch(base + "/api/v1/instagram", {
    method: "POST",
    headers: { Origin: base },
    body: "{",
  });
  assert.equal(malformed.status, 400);
  const oversized = await fetch(base + "/api/v1/instagram", {
    method: "POST",
    headers: { Origin: base },
    body: "x".repeat(20001),
  });
  assert.equal(oversized.status, 413);
  const method = await request("/api/v1/instagram/account", "POST", {});
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("allow"), "GET");
  assert.equal((await request(`/api/v1/instagram/foo/${randomUUID()}`)).status, 404);
  assert.equal((await request(`/api/v1/instagram/${randomUUID()}`)).status, 404);
  assert.equal((await request("/api/v1/instagram?cursor=bad")).status, 400);
  assert.equal((await request(`/app/instagram/posts/${randomUUID()}`)).status, 404);
});
test("filtered cursor pagination and archive are consistent; non-post captions are blocked", async () => {
  const ids = [];
  for (let i = 0; i < 5; i++) {
    const id = randomUUID();
    ids.push(id);
    assert.equal(
      (
        await request("/api/v1/instagram", "POST", {
          id,
          kind: "reference",
          username: `example${i}`,
        })
      ).status,
      200,
    );
  }
  const first = (await (await request("/api/v1/instagram?kind=reference&limit=2")).json()).data;
  assert.equal(first.items.length, 2);
  assert.equal(first.meta.has_more, true);
  const second = (
    await (
      await request(`/api/v1/instagram?kind=reference&limit=2&cursor=${first.meta.cursor}`)
    ).json()
  ).data;
  assert.equal(second.items.length, 2);
  assert.ok(second.items.every((item) => !first.items.some((previous) => previous.id === item.id)));
  assert.equal(
    (await request(`/api/v1/instagram/${ids[0]}`, "PATCH", { caption: "invalid" })).status,
    409,
  );
  assert.equal((await request(`/api/v1/instagram/${ids[0]}`, "DELETE")).status, 200);
  assert.equal((await request(`/api/v1/instagram/${ids[0]}`)).status, 404);
});
test("entire carousel continues server-side, preserves 8 slides and rejects implicit replacement", async () => {
  const id = randomUUID();
  const item_ids = Array.from({ length: 8 }, () => randomUUID());
  const body = {
    id,
    item_ids,
    template: "noticia_impacto_operacional",
    brief: "Uma novidade com fatos fornecidos para uma narrativa de conteúdo.",
    niche: "Consultoria",
    use_logo: false,
    format: "feed",
  };
  const first = await request("/api/v1/instagram/carousels", "POST", body);
  assert.equal(first.status, 202);
  assert.equal((await first.json()).data.items.length, 8);
  assert.equal((await request("/api/v1/instagram/carousels", "POST", body)).status, 202);
  assert.equal(
    (
      await request("/api/v1/instagram/carousels", "POST", {
        ...body,
        item_ids: Array.from({ length: 8 }, () => randomUUID()),
      })
    ).status,
    409,
  );
  await Promise.all(item_ids.map(ready));
  const items = (await (await request(`/api/v1/instagram?carousel_id=${id}&limit=8`)).json()).data
    .items;
  assert.equal(items.length, 8);
  assert.ok(items.every((item) => item.status === "ready"));
  assert.equal(items.filter((item) => item.caption).length, 1);
  const hashes = await Promise.all(
    item_ids.map(async (id) =>
      createHash("sha256")
        .update(Buffer.from(await (await request(`/api/assets/${id}`)).arrayBuffer()))
        .digest("hex"),
    ),
  );
  assert.equal(new Set(hashes).size, 8, "Demo slides must have distinct visible content");
});
test("explicit retry creates a new UUID atomically and preserves carousel cardinality", async () => {
  const db = new DatabaseSync(join(process.env.STUDIO_DATA_DIR, "studio.sqlite"));
  const id = randomUUID();
  const group = randomUUID();
  const now = new Date().toISOString();
  const body = {
    ...input(),
    id,
    carousel: { id: group, template: "noticia_impacto_operacional", slide: 1 },
  };
  const item = {
    id,
    kind: "post",
    status: "failed",
    input: body,
    caption: "",
    answer: "",
    sources: [],
    asset_path: null,
    error: "Interrupted fixture",
    created_at: now,
    updated_at: now,
  };
  db.prepare(
    "INSERT INTO items(tenant,id,kind,status,carousel_id,created_at,value) VALUES(?,?,?,?,?,?,?)",
  ).run("local", id, "post", "failed", group, now, JSON.stringify(item));
  db.close();
  const response = await request(`/api/v1/instagram/${id}/retry`, "POST");
  assert.equal(response.status, 202);
  const created = (await response.json()).data;
  assert.notEqual(created.id, id);
  assert.equal((await request(`/api/v1/instagram/${id}`)).status, 404);
  await ready(created.id);
  const items = (await (await request(`/api/v1/instagram?carousel_id=${group}`)).json()).data.items;
  assert.equal(items.length, 1);
  assert.equal(items[0].id, created.id);
  assert.equal((await request(`/api/v1/instagram/${created.id}/retry`, "POST")).status, 409);
});
test("demo research has a useful error; social effects remain gated", async () => {
  const research = await request("/api/v1/instagram", "POST", {
    id: randomUUID(),
    kind: "research",
    niche: "Varejo",
    brief: "Tendências",
  });
  assert.equal(research.status, 503);
  assert.match((await research.json()).error.message, /credencial/);
  assert.equal((await (await request("/api/v1/instagram/config")).json()).data.mode, "demo");
  assert.equal(
    (await request("/api/v1/instagram/publish", "POST", { id: randomUUID() })).status,
    503,
  );
  assert.equal((await request("/api/v1/growth/instagram", "POST", {})).status, 503);
  for (const path of [
    "/app/instagram",
    "/app/instagram/new",
    "/app/instagram/library",
    "/app/instagram/inspirations",
    "/app/instagram/insights",
    "/app/instagram/growth",
    "/app/connections",
  ]) {
    const response = await request(path);
    assert.equal(response.status, 200, path);
    assert.match(await response.text(), /Instagram/);
  }
  const favicon = await request("/favicon.svg");
  assert.equal(favicon.status, 200);
});
test("unexpected storage errors return sanitized 500 and a traceable request ID", async () => {
  const db = new DatabaseSync(join(process.env.STUDIO_DATA_DIR, "studio.sqlite"));
  const id = randomUUID();
  db.prepare("INSERT INTO items(tenant,id,kind,status,created_at,value) VALUES(?,?,?,?,?,?)").run(
    "local",
    id,
    "reference",
    "ready",
    new Date().toISOString(),
    "private malformed record",
  );
  try {
    const response = await request(`/api/v1/instagram/${id}`);
    assert.equal(response.status, 500);
    const error = (await response.json()).error;
    assert.equal(error.code, "internal_error");
    assert.equal(error.request_id, response.headers.get("x-request-id"));
    assert.ok(!error.message.includes("private"));
  } finally {
    db.prepare("DELETE FROM items WHERE tenant=? AND id=?").run("local", id);
    db.close();
  }
});
