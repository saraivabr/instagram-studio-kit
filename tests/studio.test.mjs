import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createAi,
  createStudio,
  createSchema,
  carouselSlideBrief,
  publicationInput,
  publicationResult,
  requireInstagramAccount,
  openAiTransport,
} from "../packages/core/dist/index.js";
import { memoryRepository } from "../examples/memory.mjs";
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jh+kAAAAASUVORK5CYII=";
const input = () => ({
  id: randomUUID(),
  kind: "post",
  brief: "Organize melhor o atendimento.",
  niche: "Consultoria",
  format: "feed",
});
function harness(request) {
  const calls = [];
  const saved = [];
  const ai = createAi(
    async (...args) => {
      calls.push(args);
      return request
        ? request(...args)
        : args[0].startsWith("images/")
          ? { data: [{ b64_json: png }] }
          : {
              output: [
                {
                  type: "message",
                  content: [{ type: "output_text", text: "Legenda" }],
                },
              ],
            };
    },
    { image: "image-test", text: "text-test" },
  );
  const repository = memoryRepository();
  return {
    calls,
    saved,
    repository,
    studio: createStudio({
      ai,
      repository,
      assets: {
        async save(org, id, bytes) {
          saved.push({ org, id, bytes });
          return `${org}/${id}`;
        },
      },
    }),
  };
}
test("generation persists a private asset and caption", async () => {
  const h = harness();
  const item = await h.studio.create("a", input());
  assert.equal(item.status, "ready");
  assert.equal(item.caption, "Legenda");
  assert.equal(h.saved.length, 1);
  assert.equal(h.calls.length, 2);
});
test("same UUID has no additional paid calls, including concurrent requests", async () => {
  const h = harness();
  const i = input();
  await Promise.all([h.studio.create("a", i), h.studio.create("a", i)]);
  await h.studio.create("a", i);
  assert.equal(h.calls.length, 2);
});
test("tenant isolation with identical UUIDs", async () => {
  const h = harness();
  const i = input();
  const a = await h.studio.create("a", i);
  const b = await h.studio.create("b", i);
  assert.notEqual(a.asset_path, b.asset_path);
  assert.equal(h.calls.length, 4);
  await assert.rejects(h.repository.complete("c", i.id, {}));
});
test("provider failure persists failed and retry does not spend again", async () => {
  const h = harness(() => {
    throw new Error("provider unavailable");
  });
  const i = input();
  await assert.rejects(h.studio.create("a", i));
  const item = await h.studio.create("a", i);
  assert.equal(item.status, "failed");
  assert.equal(h.calls.length, 1);
});
test("storage failure preserves failed state", async () => {
  const h = harness();
  const i = input();
  const studio = createStudio({
    repository: h.repository,
    ai: createAi(
      async (path) =>
        path.startsWith("images/")
          ? { data: [{ b64_json: png }] }
          : {
              output: [
                {
                  type: "message",
                  content: [{ type: "output_text", text: "caption" }],
                },
              ],
            },
      { image: "i", text: "t" },
    ),
    assets: {
      async save() {
        throw new Error("storage");
      },
    },
  });
  await assert.rejects(studio.create("a", i));
  assert.equal((await studio.create("a", i)).status, "failed");
});
test("invalid input and logo do not call provider", async () => {
  const h = harness();
  await assert.rejects(h.studio.create("a", { ...input(), brief: "x" }));
  const logoInput = input();
  await assert.rejects(
    h.studio.create("a", logoInput, undefined, {
      bytes: new Uint8Array([1, 2]),
      type: "image/png",
    }),
  );
  assert.equal(h.calls.length, 0);
  assert.equal(
    (await h.repository.claim("a", logoInput)).created,
    true,
    "Invalid logos cannot reserve a UUID permanently",
  );
});
test("carousel only generates a caption on slide one", async () => {
  const h = harness();
  const group = randomUUID();
  for (let slide = 1; slide <= 8; slide++) {
    await h.studio.create("a", {
      ...input(),
      carousel: { id: group, template: "noticia_impacto_operacional", slide },
    });
  }
  assert.equal(h.calls.length, 9);
  assert.equal(h.saved.length, 8);
  assert.match(h.calls.at(-1)[1].prompt, /Slide 8\/8/);
  assert.throws(() => carouselSlideBrief("x", "noticia_impacto_operacional", 9));
});
test("reference stays local and research requires sources", async () => {
  const h = harness();
  const item = await h.studio.create("a", {
    id: randomUUID(),
    kind: "reference",
    username: "@example",
  });
  assert.equal(item.input.username, "example");
  assert.equal(h.calls.length, 0);
  await assert.rejects(
    h.studio.create("a", {
      id: randomUUID(),
      kind: "research",
      niche: "Varejo",
      brief: "Tendências",
      references: [],
    }),
  );
});
test("publication schema rejects duplicate assets and invalid quantity", () => {
  const id = randomUUID();
  assert.equal(
    publicationInput.safeParse({
      id,
      account_id: "a".repeat(24),
      item_ids: [id, id],
      format: "carousel",
      caption: "",
    }).success,
    false,
  );
  assert.equal(createSchema.safeParse({ ...input(), tenantId: "untrusted" }).success, false);
});
test("only the target receipt confirms publication", () => {
  const value = {
    post: {
      _id: "p",
      status: "published",
      platforms: [{ platform: "instagram", accountId: "a", status: "pending" }],
    },
  };
  assert.equal(publicationResult(value, "a").status, "pending");
  assert.throws(() => publicationResult(value, "b"));
});
test("foreign and inactive accounts rejected", () => {
  assert.throws(() => requireInstagramAccount({ key: "test", profileId: "p", accounts: [] }, "a"));
  assert.throws(() =>
    requireInstagramAccount(
      {
        key: "test",
        profileId: "p",
        accounts: [{ _id: "a", isActive: false }],
      },
      "a",
    ),
  );
});
test("transport uses fixed origin, blocks redirects and exposes no provider body", async () => {
  let observed;
  const transport = openAiTransport("test-key", async (url, options) => {
    observed = { url, options };
    return new Response('{"secret":"sensitive"}', { status: 401 });
  });
  await assert.rejects(
    transport("responses", { model: "mock" }),
    (error) => !error.message.includes("sensitive"),
  );
  assert.equal(observed.options.redirect, "error");
  assert.equal(observed.url, "https://api.openai.com/v1/responses");
  await assert.rejects(transport("../evil", {}));
});
