import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { Blob } from "node:buffer";
import { join } from "node:path";
import sharp from "sharp";
const base = process.env.STUDIO_TEST_URL || "http://127.0.0.1:4319";
const data = process.env.STUDIO_DATA_DIR;
const call = (path, method = "GET", body, headers = {}) =>
  fetch(base + path, {
    method,
    headers: {
      Origin: base,
      ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
  });
const upload = (bytes, type, name = "logo.png") => {
  const form = new FormData();
  form.append("logo", new Blob([bytes], { type }), name);
  return call("/api/v1/brand/logo", "POST", form);
};
const red = (width, height) =>
  sharp({ create: { width, height, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } })
    .png()
    .toBuffer();
const post = (extra = {}) => ({
  id: randomUUID(),
  kind: "post",
  brief: "Demonstração da marca no estúdio.",
  niche: "Tributos para empresas",
  format: "feed",
  use_logo: true,
  ...extra,
});
async function ready(id) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const item = (await (await call(`/api/v1/instagram/${id}`)).json()).data;
    if (item.status !== "generating") {
      assert.equal(item.status, "ready", item.error);
      return item;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Geração não terminou");
}
/** Count pixels that are exactly the red of the test logo in the bottom-right corner. */
async function redPixels(id) {
  const png = Buffer.from(await (await call(`/api/assets/${id}`)).arrayBuffer());
  const { width, height } = await sharp(png).metadata();
  const { data: pixels, info } = await sharp(png)
    .extract({
      left: Math.floor(width / 2),
      top: Math.floor(height / 2),
      width: Math.ceil(width / 2),
      height: Math.ceil(height / 2),
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let count = 0;
  let maxX = 0;
  let maxY = 0;
  for (let i = 0; i < pixels.length; i += 4)
    if (pixels[i] === 255 && pixels[i + 1] === 0 && pixels[i + 2] === 0) {
      count++;
      const index = i / 4;
      maxX = Math.max(maxX, index % info.width);
      maxY = Math.max(maxY, Math.floor(index / info.width));
    }
  return {
    count,
    width,
    height,
    right: Math.floor(width / 2) + maxX,
    bottom: Math.floor(height / 2) + maxY,
  };
}
const logoFiles = () => {
  const directory = join(data, "assets", createHash("sha256").update("local").digest("hex"));
  try {
    return readdirSync(directory).filter((name) => name.startsWith("brand-logo-"));
  } catch {
    return [];
  }
};
test("without a registered brand the app keeps its defaults", async () => {
  const brand = (await (await call("/api/v1/brand")).json()).data;
  assert.equal(brand.name, "Sua empresa");
  assert.equal(brand.accent, "#506d48");
  assert.equal(brand.logo_url, null);
  assert.equal(brand.can_edit, true);
  assert.equal((await call("/api/v1/brand/logo")).status, 404);
  const item = await ready(
    (await (await call("/api/v1/instagram", "POST", post())).json()).data.id,
  );
  assert.ok(item.asset_path);
});
test("brand fields are validated and survive a reload", async () => {
  for (const bad of [
    { name: "", description: "Tributos", accent: "#112233" },
    { name: "x".repeat(101), description: "Tributos", accent: "#112233" },
    { name: "Ghost", description: "Tributos", accent: "verde" },
    { name: "Ghost", description: "Tributos", accent: "#12345" },
    { name: "Ghost", description: "y".repeat(2001), accent: "#112233" },
  ])
    assert.equal((await call("/api/v1/brand", "PUT", bad)).status, 400);
  const saved = await call("/api/v1/brand", "PUT", {
    name: "Ghost",
    description: "IA para o mercado tributário",
    accent: "#7BBF7A",
  });
  assert.equal(saved.status, 200);
  const brand = (await (await call("/api/v1/brand")).json()).data;
  assert.equal(brand.name, "Ghost");
  assert.equal(brand.description, "IA para o mercado tributário");
  assert.equal(brand.accent, "#7bbf7a");
  assert.equal(brand.logo_mode, "stamp");
  assert.equal(brand.registered, true);
});
test("invalid logo files are refused with a clear message", async () => {
  const cases = [
    [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), "image/svg+xml", "logo.svg"],
    [Buffer.from("%PDF-1.7 fake"), "application/pdf", "logo.pdf"],
    [
      await sharp(await red(20, 20))
        .webp()
        .toBuffer(),
      "image/webp",
      "logo.webp",
    ],
    [
      Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from("not really a png")]),
      "image/png",
      "x.png",
    ],
  ];
  for (const [bytes, type, name] of cases) {
    const response = await upload(bytes, type, name);
    assert.equal(response.status, 400, name);
    assert.match((await response.json()).error.message, /PNG ou JPG|corrompida/);
  }
  const big = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(5_100_000)]);
  const response = await upload(big, "image/png");
  assert.equal(response.status, 413);
  assert.match((await response.json()).error.message, /5 MB/);
  assert.equal((await call("/api/v1/brand/logo", "POST", {})).status, 400);
  assert.equal((await (await call("/api/v1/brand")).json()).data.logo_url, null);
});
test("logo upload needs a same-origin request", async () => {
  const form = new FormData();
  form.append("logo", new Blob([await red(10, 10)], { type: "image/png" }), "logo.png");
  const response = await fetch(base + "/api/v1/brand/logo", {
    method: "POST",
    headers: { Origin: "http://evil.example" },
    body: form,
  });
  assert.equal(response.status, 403);
});
test("the logo is normalized, served privately and stamped identically on every art", async () => {
  const response = await upload(await red(2000, 800), "image/png");
  assert.equal(response.status, 200);
  const brand = (await response.json()).data;
  assert.match(brand.logo_url, /^\/api\/v1\/brand\/logo\?v=/);
  const served = await call("/api/v1/brand/logo");
  assert.equal(served.headers.get("content-type"), "image/png");
  assert.match(served.headers.get("cache-control"), /private/);
  const meta = await sharp(Buffer.from(await served.arrayBuffer())).metadata();
  assert.equal(meta.width, 1024);
  assert.equal(meta.height, 410);
  const item = await ready(
    (await (await call("/api/v1/instagram", "POST", post())).json()).data.id,
  );
  const stamped = await redPixels(item.id);
  assert.ok(stamped.count > 2000, "logo original aplicado");
  assert.ok(
    stamped.right <= stamped.width - Math.round(stamped.width * 0.08),
    "dentro da área segura direita",
  );
  assert.ok(
    stamped.bottom <= stamped.height - Math.round(stamped.height * 0.08),
    "dentro da área segura inferior",
  );
  const without = await ready(
    (await (await call("/api/v1/instagram", "POST", post({ use_logo: false }))).json()).data.id,
  );
  assert.equal((await redPixels(without.id)).count, 0);
});
test("a carousel carries the logo on all 8 slides", async () => {
  const ids = Array.from({ length: 8 }, () => randomUUID());
  const response = await call("/api/v1/instagram/carousels", "POST", {
    id: randomUUID(),
    item_ids: ids,
    template: "noticia_impacto_operacional",
    brief: "Uma novidade para o dia a dia da empresa.",
    niche: "Tributos para empresas",
    use_logo: true,
    format: "feed",
  });
  assert.equal(response.status, 202);
  for (const id of ids) {
    await ready(id);
    assert.ok((await redPixels(id)).count > 2000, id);
  }
});
test("replacing or removing the logo never breaks queued generations", async () => {
  const ids = Array.from({ length: 4 }, () => randomUUID());
  for (const id of ids)
    assert.equal((await call("/api/v1/instagram", "POST", post({ id }))).status, 202);
  const blue = await sharp({
    create: { width: 300, height: 100, channels: 3, background: { r: 0, g: 0, b: 255 } },
  })
    .jpeg()
    .toBuffer();
  assert.equal((await upload(blue, "image/jpeg", "novo.jpg")).status, 200);
  assert.equal((await call("/api/v1/brand/logo", "DELETE")).status, 200);
  for (const id of ids) await ready(id);
  const after = (await (await call("/api/v1/brand")).json()).data;
  assert.equal(after.logo_url, null);
  const deadline = Date.now() + 5000;
  while (logoFiles().length && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(logoFiles(), [], "arquivos antigos removidos quando nenhum job os usa");
  const plain = await ready(
    (await (await call("/api/v1/instagram", "POST", post())).json()).data.id,
  );
  assert.ok(plain.asset_path);
});
test("AI mode still generates and keeps the logo available as reference", async () => {
  assert.equal(
    (
      await call("/api/v1/brand", "PUT", {
        name: "Ghost",
        description: "IA tributária",
        accent: "#7bbf7a",
        logo_mode: "ai",
      })
    ).status,
    200,
  );
  assert.equal((await upload(await red(300, 120), "image/png")).status, 200);
  assert.equal((await (await call("/api/v1/brand")).json()).data.logo_mode, "ai");
  const item = await ready(
    (await (await call("/api/v1/instagram", "POST", post())).json()).data.id,
  );
  assert.ok(item.asset_path);
  assert.equal((await redPixels(item.id)).count, 0, "no modo IA o arquivo não é carimbado");
  await call("/api/v1/brand/logo", "DELETE");
  await call("/api/v1/brand", "PUT", {
    name: "Ghost",
    description: "IA tributária",
    accent: "#7bbf7a",
    logo_mode: "stamp",
  });
});
