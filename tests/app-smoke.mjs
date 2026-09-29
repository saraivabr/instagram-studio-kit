import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const base = process.env.STUDIO_TEST_URL || "http://127.0.0.1:4318";
const request = (path, method = "GET", body, origin = base) =>
  fetch(base + path, {
    method,
    headers: { Origin: origin, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
test("local app creates, persists, edits and serves the same item without duplication", async () => {
  const id = randomUUID();
  const body = {
    id,
    kind: "post",
    brief: "Demonstração de integração do estúdio.",
    niche: "Serviços",
    format: "feed",
  };
  const first = await request("/api/v1/instagram", "POST", body);
  assert.equal(first.status, 200);
  const item = (await first.json()).data;
  assert.equal(item.status, "ready");
  const second = await request("/api/v1/instagram", "POST", body);
  assert.equal((await second.json()).data.asset_path, item.asset_path);
  const edit = await request(`/api/v1/instagram/${id}`, "PATCH", {
    caption: "Legenda verificada",
  });
  assert.equal((await edit.json()).data.caption, "Legenda verificada");
  const detail = await request(`/api/v1/instagram/${id}`);
  assert.equal((await detail.json()).data.caption, "Legenda verificada");
  const asset = await request(`/api/assets/${id}`);
  assert.equal(asset.headers.get("content-type"), "image/png");
  assert.equal(
    Buffer.from(await asset.arrayBuffer())
      .subarray(0, 8)
      .toString("hex"),
    "89504e470d0a1a0a",
  );
});
test("local app rejects foreign browser origins and invalid input", async () => {
  const input = {
    id: randomUUID(),
    kind: "post",
    brief: "Teste de permissão.",
    niche: "Serviços",
    format: "feed",
  };
  assert.equal(
    (
      await request(
        "/api/v1/instagram",
        "POST",
        input,
        "https://untrusted.example",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/api/v1/instagram", "POST", {
        ...input,
        organization_id: "foreign",
      })
    ).status,
    422,
  );
});
test("social effects are blocked until configured", async () => {
  assert.equal(
    (await (await request("/api/v1/instagram/publish")).json()).data
      .can_publish,
    false,
  );
  assert.equal(
    (await request("/api/v1/instagram/publish", "POST", { id: randomUUID() }))
      .status,
    422,
  );
  assert.equal(
    (await request("/api/v1/growth/instagram", "POST", {})).status,
    422,
  );
});
test("all standalone module routes render", async () => {
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
});
