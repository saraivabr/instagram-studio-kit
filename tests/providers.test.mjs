import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createAi,
  createSchema,
  defaultImageSizes,
  resolveImageSizes,
  openAiTransport,
  StudioError,
  SocialError,
  socialRequest,
  listSocialAccounts,
  instagramContext,
  instagramPosts,
  instagramAutomations,
  requireInstagramAccount,
  mutateAutomation,
  publicationResult,
  publishInstagram,
  readInstagramPublication,
  findInstagramPublication,
  instagramInsights,
} from "../packages/core/dist/index.js";

const account = "a".repeat(24);
const otherAccount = "b".repeat(24);
const profile = "c".repeat(24);
const automationId = "d".repeat(24);
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jh+kAAAAASUVORK5CYII=";
const postInput = (format = "feed") =>
  createSchema.parse({
    id: randomUUID(),
    kind: "post",
    brief: "Uma criação para testar os formatos.",
    niche: "Consultoria",
    format,
  });
const connectedAccount = (id = account, profileId = profile, extras = {}) => ({
  _id: id,
  platform: "instagram",
  isActive: true,
  profileId,
  username: "empresa",
  ...extras,
});
const context = () => ({ key: "test-key", profileId: profile, accounts: [connectedAccount()] });
const automation = (extras = {}) => ({
  id: automationId,
  accountId: account,
  name: "Enviar material",
  platform: "instagram",
  platformPostId: "123_456",
  keywords: ["GUIA"],
  matchMode: "word",
  dmMessage: "Aqui está o material solicitado.",
  commentReply: "Enviado!",
  isActive: true,
  ...extras,
});
const rule = () => ({
  name: "Enviar material",
  account_id: account,
  post_id: "123_456",
  keywords: ["GUIA"],
  match_mode: "word",
  dm_response_template: "Aqui está o material solicitado.",
  comment_reply: "Enviado!",
});
const receipt = (extras = {}, postExtras = {}) => ({
  post: {
    _id: "provider-post",
    status: "published",
    platforms: [{ platform: "instagram", accountId: account, status: "published", ...extras }],
    ...postExtras,
  },
});
function mockSocial(t, handler) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const call = {
      url: new URL(url),
      options,
      body: options.body ? JSON.parse(options.body) : undefined,
    };
    calls.push(call);
    const result = await handler(call, calls.length);
    return result instanceof Response ? result : Response.json(result);
  });
  return calls;
}

test("all creation and carousel UUIDs become lowercase", () => {
  const id = randomUUID();
  const group = randomUUID();
  const post = createSchema.parse({
    ...postInput(),
    id: id.toUpperCase(),
    carousel: {
      id: group.toUpperCase(),
      template: "noticia_impacto_operacional",
      slide: 1,
    },
  });
  assert.equal(post.id, id);
  assert.equal(post.carousel.id, group);
  for (const input of [
    { id: id.toUpperCase(), kind: "reference", username: "@exemplo" },
    { id: id.toUpperCase(), kind: "research", niche: "Consultoria", brief: "Referências" },
  ])
    assert.equal(createSchema.parse(input).id, id);
});

test("GPT Image defaults use supported sizes for every format", async () => {
  const sizes = [];
  const ai = createAi(
    async (_path, body) => {
      sizes.push(body.size);
      return { data: [{ b64_json: png }] };
    },
    { image: "gpt-image-1-mini", text: "text-test" },
  );
  for (const format of ["feed", "square", "story"]) await ai.createImage("org", postInput(format));
  assert.deepEqual(sizes, ["1024x1536", "1024x1024", "1024x1536"]);
  assert.deepEqual(resolveImageSizes("gpt-image-1", { feed: undefined }), defaultImageSizes);
});

test("image overrides validate model and geometry before any provider call", async () => {
  let calls = 0;
  const request = async () => {
    calls++;
    return { data: [{ b64_json: png }] };
  };
  for (const image of [
    "gpt-image-1",
    "gpt-image-1-mini",
    "gpt-image-1.5",
    "gpt-image-1-2025-04-15",
  ])
    assert.throws(
      () =>
        createAi(
          request,
          { image, text: "text-test" },
          {
            imageSizes: { feed: "1024x1280" },
          },
        ),
      (error) => error instanceof StudioError && error.status === 503,
    );
  for (const story of ["1153x2048", "4096x2048", "3840x3840", "1024x64", "", "auto"])
    assert.throws(() => resolveImageSizes("gpt-image-2", { story }), StudioError);
  assert.throws(() => createAi(request, { image: "  ", text: "text-test" }), StudioError);
  assert.throws(() => createAi(request, { image: "gpt-image-2", text: "" }), StudioError);
  assert.equal(calls, 0);
  const ai = createAi(
    async (_path, body) => {
      calls++;
      assert.equal(body.size, "1152x2048");
      assert.equal(body.model, "gpt-image-2");
      return { data: [{ b64_json: png }] };
    },
    { image: " gpt-image-2 ", text: "text-test" },
    { imageSizes: { story: "1152x2048" } },
  );
  await ai.createImage("org", postInput("story"));
  assert.equal(calls, 1);
});

test("OpenAI errors preserve actionable status and never expose provider payload", async () => {
  for (const status of [400, 401, 403, 404, 422, 429, 500]) {
    let calls = 0;
    const request = openAiTransport("test-key", async () => {
      calls++;
      return new Response('{"error":{"message":"sk-secret-data https://private.example"}}', {
        status,
      });
    });
    await assert.rejects(request("responses", {}), (error) => {
      assert.ok(error instanceof StudioError);
      assert.equal(error.status, status === 500 ? 502 : status);
      assert.equal(error.upstreamStatus, status);
      assert.doesNotMatch(error.message, /secret-data|private\.example/);
      return true;
    });
    assert.equal(calls, 1, "ambiguous paid requests must not retry");
  }
});

test("OpenAI network, timeout, invalid JSON and schema errors remain sanitized", async () => {
  for (const [name, status] of [
    ["Error", 502],
    ["TimeoutError", 504],
    ["AbortError", 504],
  ]) {
    const transport = openAiTransport("test-key", async () => {
      const error = new Error("Bearer private-token https://private.example");
      error.name = name;
      throw error;
    });
    await assert.rejects(
      transport("responses", {}),
      (error) => error.status === status && !/private/.test(error.message),
    );
  }
  await assert.rejects(
    openAiTransport("test-key", async () => new Response("invalid"))("responses", {}),
    StudioError,
  );
  const ai = createAi(async () => ({ unexpected: "secret" }), {
    image: "image-test",
    text: "text-test",
  });
  await assert.rejects(ai.createImage("org", postInput()), StudioError);
  await assert.rejects(ai.createCaption("org", postInput()), StudioError);
  await assert.rejects(
    ai.research("org", {
      id: randomUUID(),
      kind: "research",
      niche: "Varejo",
      brief: "Tema",
      references: [],
    }),
    StudioError,
  );
});

test("confirmed publication survives invalid, unsafe or credentialed permalink", () => {
  for (const platformPostUrl of [
    "instagram.com/p/abc",
    "broken",
    "https://example.com/p/abc",
    "http://instagram.com/p/abc",
    "https://user:password@instagram.com/p/abc",
  ])
    assert.deepEqual(publicationResult(receipt({ platformPostUrl }), account), {
      provider_post_id: "provider-post",
      status: "published",
      permalink: null,
      error: null,
    });
  assert.equal(
    publicationResult(receipt({ platformPostUrl: "https://www.instagram.com/p/abc/" }), account)
      .permalink,
    "https://www.instagram.com/p/abc/",
  );
  assert.equal(publicationResult(receipt({ status: "pending" }), account).status, "pending");
  const publishedDespiteOtherPlatform = publicationResult(
    receipt({}, { status: "failed" }),
    account,
  );
  assert.equal(publishedDespiteOtherPlatform.status, "published");
  assert.equal(publishedDespiteOtherPlatform.error, null);
  assert.equal(
    publicationResult({ existingPost: receipt({ accountId: { _id: account } }).post }, account)
      .status,
    "published",
  );
  assert.throws(() => publicationResult(receipt(), otherAccount), SocialError);
  assert.throws(() => publicationResult({ post: { secret: "private" } }, account), SocialError);
  const failed = publicationResult(
    receipt({
      status: "failed",
      errorMessage: "Bearer token sk-test-secret https://private.example",
    }),
    account,
  );
  assert.equal(failed.status, "failed");
  assert.doesNotMatch(failed.error, /sk-test-secret|private\.example|Bearer token/);
});

test("publish, read receipt and reconcile use fixed origin and canonical idempotency", async (t) => {
  const id = randomUUID();
  const calls = mockSocial(t, ({ url }) =>
    url.searchParams.has("profileId")
      ? { posts: [receipt({}, { metadata: { studio_publication_id: id } }).post] }
      : receipt(),
  );
  const input = { id: id.toUpperCase(), account_id: account, format: "feed", caption: "Legenda" };
  assert.equal(
    (await publishInstagram("test-key", input, ["https://assets.example/post.png"])).status,
    "published",
  );
  assert.equal(
    (await readInstagramPublication("test-key", "provider-post", account)).status,
    "published",
  );
  assert.equal(
    (await findInstagramPublication("test-key", profile, id.toUpperCase(), account)).status,
    "published",
  );
  assert.equal(await findInstagramPublication("test-key", profile, randomUUID(), account), null);
  assert.equal(calls.length, 4);
  assert.equal(calls[0].url.href, "https://zernio.com/api/v1/posts");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.headers["Idempotency-Key"], id);
  assert.equal(calls[0].body.metadata.studio_publication_id, id);
  assert.equal(calls[0].body.platforms[0].accountId, account);
  assert.equal(calls[1].url.pathname, "/api/v1/posts/provider-post");
  assert.equal(calls[2].url.searchParams.get("profileId"), profile);
});

test("story publications omit caption and carry story-specific metadata", async (t) => {
  const calls = mockSocial(t, () => receipt());
  await publishInstagram(
    "test-key",
    { id: randomUUID(), account_id: account, format: "story", caption: "Not sent" },
    ["https://assets.example/story.png"],
  );
  assert.equal(calls[0].body.content, "");
  assert.deepEqual(calls[0].body.platforms[0].platformSpecificData, {
    contentType: "story",
    isAiGenerated: true,
  });
});

test("direct SDK ids and path traversal fail before credentialed fetch", async (t) => {
  const calls = mockSocial(t, () => {
    throw new Error("must not fetch");
  });
  for (const path of [
    "../admin",
    "accounts/x/../../admin/posts",
    "accounts/%2e%2e/admin",
    "/posts",
    "https://evil.example",
    "posts#fragment",
    "posts\\admin",
  ])
    await assert.rejects(
      socialRequest("test-key", path),
      (error) => error instanceof SocialError && error.status === 400,
    );
  for (const id of ["x/../../admin", "../admin", ""]) {
    await assert.rejects(instagramPosts("test-key", id));
    await assert.rejects(readInstagramPublication("test-key", id, account));
    await assert.rejects(listSocialAccounts("test-key", id));
  }
  await assert.rejects(findInstagramPublication("test-key", profile, randomUUID(), "invalid"));
  await assert.rejects(
    publishInstagram(
      "test-key",
      { id: randomUUID(), account_id: "invalid", format: "feed", caption: "" },
      ["https://assets.example/post.png"],
    ),
  );
  await assert.rejects(
    publishInstagram(
      "test-key",
      { id: randomUUID(), account_id: account, format: "feed", caption: "" },
      ["http://assets.example/post.png"],
    ),
  );
  await assert.rejects(
    publishInstagram(
      "test-key",
      { id: randomUUID(), account_id: account, format: "feed", caption: "" },
      ["https://assets.example/1.png", "https://assets.example/2.png"],
    ),
  );
  assert.equal(calls.length, 0);
});

test("social client filters foreign profiles and returns sanitized upstream failures", async (t) => {
  const calls = mockSocial(t, (_call, count) =>
    count === 1
      ? { accounts: [connectedAccount(), connectedAccount(otherAccount, "e".repeat(24))] }
      : new Response('{"secret":"private upstream detail"}', { status: 429 }),
  );
  assert.deepEqual(
    (await listSocialAccounts("test-key", profile)).map((a) => a._id),
    [account],
  );
  await assert.rejects(
    socialRequest("test-key", "posts"),
    (error) =>
      error.status === 429 && error.upstreamStatus === 429 && !/private/.test(error.message),
  );
  assert.equal(calls[0].url.searchParams.get("profileId"), profile);
});

test("social transport sanitizes network failures, timeouts and invalid JSON", async (t) => {
  for (const [name, status] of [
    ["Error", 502],
    ["TimeoutError", 504],
  ]) {
    t.mock.method(globalThis, "fetch", async () => {
      const error = new Error("Bearer private-token");
      error.name = name;
      throw error;
    });
    await assert.rejects(
      socialRequest("test-key", "posts"),
      (error) => error.status === status && !/private-token/.test(error.message),
    );
    t.mock.restoreAll();
  }
  t.mock.method(globalThis, "fetch", async () => new Response("invalid"));
  await assert.rejects(
    socialRequest("test-key", "posts"),
    (error) => error instanceof SocialError && error.status === 502,
  );
});

test("account context, posts and automation listing stay within the selected organization", async (t) => {
  const calls = mockSocial(t, ({ url }) =>
    url.pathname.endsWith("/accounts")
      ? {
          accounts: [
            connectedAccount(),
            connectedAccount(otherAccount, profile, { platform: "facebook" }),
            connectedAccount("e".repeat(24), "f".repeat(24)),
          ],
        }
      : url.pathname.endsWith("/posts")
        ? { posts: [{ id: "123_456", message: "Post" }] }
        : {
            automations: [
              automation(),
              automation({ id: "f".repeat(24), accountId: otherAccount }),
              { platform: "facebook" },
            ],
          },
  );
  const resolved = await instagramContext({ key: "test-key", profileId: profile });
  assert.deepEqual(
    resolved.accounts.map((a) => a._id),
    [account],
  );
  assert.equal(requireInstagramAccount(resolved, account)._id, account);
  assert.throws(
    () => requireInstagramAccount(resolved, otherAccount),
    (error) => error.status === 404,
  );
  assert.throws(
    () =>
      requireInstagramAccount(
        { ...resolved, accounts: [connectedAccount(account, profile, { isActive: false })] },
        account,
      ),
    (error) => error.status === 422,
  );
  assert.equal((await instagramPosts("test-key", account))[0].id, "123_456");
  const rules = await instagramAutomations(resolved);
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].stats, { triggered: 0, dmsSent: 0, dmsFailed: 0, read: 0 });
  assert.equal(calls[1].url.pathname, `/api/v1/accounts/${account}/posts`);
});

test("automation creation sends authorized post, provider profile and idempotency headers", async (t) => {
  const calls = mockSocial(t, ({ url, body }) =>
    body
      ? { success: true }
      : url.pathname.endsWith("comment-automations")
        ? { automations: [] }
        : { posts: [{ id: "123_456", message: "Post escolhido" }] },
  );
  const id = randomUUID();
  assert.deepEqual(await mutateAutomation(context(), { action: "create", id, rule: rule() }), {
    saved: true,
  });
  assert.equal(calls.length, 3);
  assert.equal(calls[2].body.accountId, account);
  assert.equal(calls[2].body.profileId, profile);
  assert.equal(calls[2].body.platformPostId, "123_456");
  assert.equal(calls[2].options.headers["Idempotency-Key"], id);
});

test("automation reconciliation avoids duplicate creates and refuses conflicting active rule", async (t) => {
  const calls = mockSocial(t, ({ url }) =>
    url.pathname.endsWith("comment-automations")
      ? { automations: [automation()] }
      : { posts: [{ id: "123_456", message: "Post" }] },
  );
  const result = await mutateAutomation(context(), {
    action: "create",
    id: randomUUID(),
    rule: rule(),
  });
  assert.equal(result.automation.id, automationId);
  await assert.rejects(
    mutateAutomation(context(), {
      action: "create",
      id: randomUUID(),
      rule: { ...rule(), name: "Outro nome" },
    }),
    (error) => error.status === 409,
  );
  assert.ok(calls.every((call) => call.options.method === "GET"));
});

test("automation edit and toggle use PATCH; missing, foreign and inactive rules cannot mutate", async (t) => {
  const calls = mockSocial(t, ({ url, body }) =>
    body
      ? { success: true }
      : url.pathname.endsWith("comment-automations")
        ? { automations: [automation()] }
        : { posts: [{ id: "123_456", message: "Post" }] },
  );
  await mutateAutomation(context(), { action: "toggle", id: automationId, is_active: false });
  await mutateAutomation(context(), {
    action: "edit",
    id: automationId,
    rule: { ...rule(), name: "Novo nome" },
  });
  const mutations = calls.filter((call) => call.body);
  assert.equal(mutations.length, 2);
  assert.ok(mutations.every((call) => call.options.method === "PATCH"));
  assert.deepEqual(mutations[0].body, { isActive: false });
  assert.equal(mutations[1].body.name, "Novo nome");
  await assert.rejects(
    mutateAutomation(context(), { action: "toggle", id: "e".repeat(24), is_active: false }),
    (error) => error.status === 404,
  );
  await assert.rejects(
    mutateAutomation(context(), {
      action: "edit",
      id: automationId,
      rule: { ...rule(), post_id: "999" },
    }),
    (error) => error.status === 422,
  );
  await assert.rejects(
    mutateAutomation(
      { ...context(), accounts: [connectedAccount(otherAccount)] },
      { action: "toggle", id: automationId, is_active: false },
    ),
    (error) => error.status === 404,
  );
  await assert.rejects(
    mutateAutomation(
      { ...context(), accounts: [connectedAccount(account, profile, { isActive: false })] },
      { action: "toggle", id: automationId, is_active: false },
    ),
    (error) => error.status === 422,
  );
  assert.equal(calls.filter((call) => call.body).length, 2);
});

test("automation creation validates ownership of the selected published post", async (t) => {
  const calls = mockSocial(t, ({ url }) =>
    url.pathname.endsWith("comment-automations") ? { automations: [] } : { posts: [] },
  );
  await assert.rejects(
    mutateAutomation(context(), { action: "create", id: randomUUID(), rule: rule() }),
    (error) => error.status === 422,
  );
  assert.ok(calls.every((call) => call.options.method === "GET"));
});

test("insights only query active owned Instagram accounts and preserve missing metrics", async (t) => {
  let metricAccount = account;
  const calls = mockSocial(t, ({ url }) =>
    url.pathname.endsWith("accounts")
      ? {
          accounts: [
            connectedAccount(),
            connectedAccount(otherAccount, profile, { isActive: false }),
            connectedAccount("e".repeat(24), "f".repeat(24)),
          ],
        }
      : {
          success: true,
          accountId: metricAccount,
          dateRange: { since: "2026-09-01", until: "2026-10-01" },
          metrics: { reach: { total: 12 } },
          unavailableMetrics: ["views"],
        },
  );
  assert.deepEqual(await instagramInsights(null), { connected: false, accounts: [] });
  assert.equal(
    (await instagramInsights({ key: "test-key", profileId: profile })).accounts.length,
    1,
  );
  await assert.rejects(
    instagramInsights({ key: "test-key", profileId: profile }, otherAccount),
    (error) => error.status === 404,
  );
  const result = await instagramInsights({ key: "test-key", profileId: profile }, account);
  assert.equal(result.insights.metrics.reach.total, 12);
  assert.deepEqual(result.insights.unavailableMetrics, ["views"]);
  const metricCalls = calls.filter((call) => call.url.pathname.includes("account-insights"));
  assert.equal(metricCalls.length, 1);
  assert.equal(metricCalls[0].url.searchParams.get("accountId"), account);
  assert.equal(metricCalls[0].url.searchParams.get("metricType"), "total_value");
  metricAccount = otherAccount;
  await assert.rejects(
    instagramInsights({ key: "test-key", profileId: profile }, account),
    (error) => error instanceof SocialError && error.status === 502,
  );
});

test("malformed social provider responses are upstream errors, not user validation errors", async (t) => {
  mockSocial(t, ({ url }) =>
    url.pathname.endsWith("accounts")
      ? { accounts: [connectedAccount()] }
      : url.pathname.endsWith("comment-automations")
        ? { automations: [] }
        : { invalid: "private" },
  );
  await assert.rejects(
    instagramPosts("test-key", account),
    (error) => error instanceof SocialError && error.status === 502,
  );
  await assert.rejects(
    instagramInsights({ key: "test-key", profileId: profile }, account),
    (error) => error instanceof SocialError && error.status === 502,
  );
  await assert.rejects(
    readInstagramPublication("test-key", "provider-post", account),
    (error) => error instanceof SocialError && error.status === 502,
  );
});
