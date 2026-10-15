import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../apps/studio/package.json", import.meta.url));
const sharp = require("sharp");
const originalFetch = globalThis.fetch;
const statePath = process.env.STUDIO_SOCIAL_TEST_STATE;
if (!statePath) throw new Error("The Zernio fixture requires an isolated state file.");
const owners = new Map([
  ["studio-test-key", "primary"],
  ["studio-test-rotated", "rotated"],
]);
const profileIds = { primary: "111111111111111111111111", rotated: "222222222222222222222222" };
const accountIds = { primary: "aaaaaaaaaaaaaaaaaaaaaaaa", rotated: "bbbbbbbbbbbbbbbbbbbbbbbb" };
const inactiveId = "cccccccccccccccccccccccc";
const foreignId = "ffffffffffffffffffffffff";
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const read = () => JSON.parse(readFileSync(statePath, "utf8"));
const save = (state) => writeFileSync(statePath, JSON.stringify(state));
const account = (id, profileId, active = true) => ({
  _id: id,
  profileId,
  platform: "instagram",
  username: id === inactiveId ? "studio_inactive" : "studio_test",
  displayName: "Studio Test",
  profilePicture: "https://media.zernio.com/avatar.jpg",
  isActive: active,
});

globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.origin === "https://bucket.r2.cloudflarestorage.com") {
    const request = new Request(input, init);
    const bytes = Buffer.from(await request.arrayBuffer());
    const metadata = await sharp(bytes).metadata();
    const state = read();
    state.uploads.push({
      path: url.pathname,
      method: request.method,
      format: metadata.format,
      width: metadata.width,
      height: metadata.height,
      content_type: request.headers.get("content-type"),
      has_authorization: request.headers.has("authorization"),
      size: bytes.length,
    });
    save(state);
    return new Response(null, { status: 200 });
  }
  if (url.origin !== "https://zernio.com") return originalFetch(input, init);
  if (!url.pathname.startsWith("/api/v1/"))
    return json({ error: "Unexpected Zernio fixture path" }, 501);

  const request = new Request(input, init);
  const key = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const owner = owners.get(key);
  const text = await request.text();
  const body = text ? JSON.parse(text) : undefined;
  const path = url.pathname.slice("/api/v1/".length);
  const state = read();
  state.requests.push({
    owner: owner ?? "invalid",
    method: request.method,
    path,
    query: Object.fromEntries(url.searchParams),
    ...(body ? { body } : {}),
    request_id: request.headers.get("x-request-id"),
    idempotency_key: request.headers.get("idempotency-key"),
  });
  save(state);
  if (!owner) return json({ error: "Invalid API key" }, 401);
  const profile = state.profiles[owner];
  const ownAccounts = state.accounts[owner] ?? [];
  const reply = (value, status) => {
    save(state);
    return json(value, status);
  };
  if (path === "profiles" && request.method === "GET")
    return json({
      profiles:
        profile && profile.externalId === url.searchParams.get("externalId") ? [profile] : [],
    });
  if (path === "profiles" && request.method === "POST") {
    if (profile) return json({ error: "externalId already exists" }, 409);
    state.profiles[owner] = { _id: profileIds[owner], ...body };
    return reply({ profile: state.profiles[owner] });
  }
  if (path.startsWith("profiles/") && request.method === "GET") {
    if (state.delay_profile_reads_ms)
      await new Promise((resolve) => setTimeout(resolve, state.delay_profile_reads_ms));
    const deadline = Date.now() + 5000;
    while (read().hold_profile_reads && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    return profile?._id === path.split("/")[1]
      ? json({ profile })
      : json({ error: "Profile not found" }, 404);
  }
  if (path === "accounts" && request.method === "GET")
    return json({
      accounts: [...ownAccounts, account(foreignId, "999999999999999999999999")],
    });
  if (path === "connect/instagram") {
    const reconnect = url.searchParams.get("reconnectAccountId");
    if (reconnect && !ownAccounts.some((entry) => entry._id === reconnect))
      return json({ error: "Account not found" }, 404);
    const connectedId = reconnect || accountIds[owner];
    const current = ownAccounts.find((entry) => entry._id === connectedId);
    if (current) current.isActive = true;
    else ownAccounts.push(account(connectedId, profile._id));
    if (owner === "primary" && !ownAccounts.some((entry) => entry._id === inactiveId))
      ownAccounts.push(account(inactiveId, profile._id, false));
    state.accounts[owner] = ownAccounts;
    const auth = new URL("https://zernio.com/connect/mock");
    auth.searchParams.set("redirect_url", url.searchParams.get("redirect_url"));
    auth.searchParams.set("accountId", connectedId);
    auth.searchParams.set("username", "studio_test");
    return reply({ authUrl: auth.toString() });
  }
  if (/^accounts\/[a-f0-9]{24}$/.test(path) && request.method === "DELETE") {
    const id = path.split("/")[1];
    if (!ownAccounts.some((entry) => entry._id === id))
      return json({ error: "Account not found" }, 404);
    state.accounts[owner] = ownAccounts.filter((entry) => entry._id !== id);
    return reply({ success: true });
  }
  if (/^accounts\/[a-f0-9]{24}\/posts$/.test(path))
    return json({
      posts: [{ id: "17900000000000001", message: "Post de teste da conta profissional" }],
    });
  if (path === "media/presign") {
    const index = ++state.presigns;
    return reply({
      uploadUrl: `https://bucket.r2.cloudflarestorage.com/temp/${index}.jpg?sig=test`,
      publicUrl: `https://media.zernio.com/temp/${index}.jpg`,
    });
  }
  if (path === "posts" && request.method === "POST") {
    const caption = body.content ?? "";
    const status = caption.includes("[cancelled]")
      ? "cancelled"
      : caption.includes("[failed]")
        ? "failed"
        : "published";
    const post = {
      _id: `post-${state.posts.length + 1}`,
      profileId: profile._id,
      owner,
      status,
      metadata: body.metadata,
      // The documented single-target response may omit accountId.
      platforms: [
        {
          platform: "instagram",
          status,
          platformPostUrl: "https://www.instagram.com/p/studio_test/",
        },
      ],
    };
    if (status === "failed")
      post.platforms[0].errorMessage = "A conta precisa de permissão para publicar.";
    state.posts.push(post);
    save(state);
    if (caption.includes("[timeout]")) {
      const error = new Error("Fixture timeout");
      error.name = "TimeoutError";
      throw error;
    }
    if (caption.includes("[conflict]")) return json({ code: "idempotency_conflict" }, 409);
    return json({ post });
  }
  if (path === "posts" && request.method === "GET")
    return json({ posts: state.posts.filter((post) => post.owner === owner) });
  if (path.startsWith("posts/") && request.method === "GET") {
    const post = state.posts.find(
      (entry) => entry.owner === owner && entry._id === path.split("/")[1],
    );
    return post ? json({ post }) : json({ error: "Post not found" }, 404);
  }
  if (path === "analytics/instagram/account-insights")
    return json({
      success: true,
      accountId: url.searchParams.get("accountId"),
      dateRange: { since: "2026-09-14", until: "2026-10-14" },
      metrics: {
        reach: { total: 1200 },
        views: { total: 2400 },
        accounts_engaged: { total: 100 },
        total_interactions: { total: 180 },
      },
    });
  if (path === "comment-automations" && request.method === "GET")
    return json({ automations: state.automations.filter((entry) => entry.owner === owner) });
  if (path === "comment-automations" && request.method === "POST") {
    state.automations.push({
      ...body,
      owner,
      id: (state.automations.length + 1).toString(16).padStart(24, "d"),
      platform: "instagram",
      isActive: true,
      stats: { triggered: 5, dmsSent: 4, dmsFailed: 1, read: 3 },
    });
    return reply({ success: true });
  }
  if (/^comment-automations\/[a-f0-9]{24}$/.test(path) && request.method === "PATCH") {
    const automation = state.automations.find(
      (entry) => entry.owner === owner && entry.id === path.split("/")[1],
    );
    if (!automation) return json({ error: "Automation not found" }, 404);
    Object.assign(automation, body);
    return reply({ success: true });
  }
  if (/^comment-automations\/[a-f0-9]{24}\/logs$/.test(path))
    return json({
      logs: [
        {
          id: "log-1",
          commentText: "quero",
          commenterName: "Pessoa de teste",
          status: "sent",
          createdAt: "2026-10-14T12:00:00.000Z",
        },
      ],
    });
  return json({ error: "Unexpected Zernio fixture operation" }, 501);
};
