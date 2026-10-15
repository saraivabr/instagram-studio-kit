import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const require = createRequire(new URL("../apps/studio/package.json", import.meta.url));
const appDirectory = fileURLToPath(new URL("../apps/studio", import.meta.url));
const fixture = fileURLToPath(new URL("./fixtures/zernio-fetch.mjs", import.meta.url));
const port = Number(process.env.STUDIO_TEST_PORT || 4319) + 3;
const base = `http://127.0.0.1:${port}`;
const primaryAccount = "aaaaaaaaaaaaaaaaaaaaaaaa";
const rotatedAccount = "bbbbbbbbbbbbbbbbbbbbbbbb";
const inactiveAccount = "cccccccccccccccccccccccc";
const foreignAccount = "ffffffffffffffffffffffff";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const keys = ["studio-test-key", "studio-test-rotated", "studio-test-invalid"];

test(
  "Zernio app integration connects, publishes safely, reconciles and survives key rotation",
  { timeout: 240000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "instagram-studio-social-"));
    const statePath = join(directory, "provider.json");
    const initialState = {
      profiles: {},
      accounts: {},
      posts: [],
      automations: [],
      uploads: [],
      requests: [],
      presigns: 0,
    };
    await writeFile(statePath, JSON.stringify(initialState));
    let server;
    let serverFailure;
    let serverExited;
    let logs = "";
    const state = async () => JSON.parse(await readFile(statePath, "utf8"));
    const call = async (path, method = "GET", body) => {
      const response = await fetch(base + path, {
        method,
        headers: { Origin: base, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30000),
      });
      const value = await response.json();
      for (const key of keys)
        assert.equal(
          JSON.stringify(value).includes(key),
          false,
          "Server credentials stay out of API responses",
        );
      return { response, data: value.data, error: value.error };
    };
    async function stop() {
      if (!server) return;
      const child = server;
      server = undefined;
      if (child.exitCode !== null || child.signalCode !== null || serverFailure) return;
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
      await serverExited;
      clearTimeout(timer);
    }
    async function boot(key = "") {
      serverFailure = undefined;
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
            NODE_OPTIONS: `--import=${pathToFileURL(fixture).href}`,
            STUDIO_SOCIAL_TEST_STATE: statePath,
            STUDIO_DATA_DIR: join(directory, "data"),
            STUDIO_DAILY_GENERATION_LIMIT: "40",
            STUDIO_ESTIMATED_GENERATION_COST_USD: "0",
            STUDIO_DAILY_BUDGET_USD: "0",
            OPENAI_API_KEY: "",
            OPENAI_IMAGE_MODEL: "",
            OPENAI_TEXT_MODEL: "",
            OPENAI_IMAGE_SIZE_FEED: "",
            OPENAI_IMAGE_SIZE_SQUARE: "",
            OPENAI_IMAGE_SIZE_STORY: "",
            ZERNIO_API_KEY: key,
            ZERNIO_PROFILE_ID: "",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const collect = (chunk) => {
        logs = (logs + chunk.toString()).slice(-200000);
      };
      server.stdout.on("data", collect);
      server.stderr.on("data", collect);
      server.on("error", (error) => {
        serverFailure = error;
      });
      serverExited = new Promise((resolve) => server.once("exit", resolve));
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        if (serverFailure) throw serverFailure;
        if (server.exitCode !== null)
          throw new Error("Social test server exited before readiness.");
        try {
          if ((await fetch(`${base}/favicon.svg`, { signal: AbortSignal.timeout(1000) })).ok)
            return;
        } catch {}
        await pause(200);
      }
      throw new Error("Social test server did not become ready in 30 seconds.");
    }
    const create = async (format = "feed") => {
      const id = randomUUID();
      const created = await call("/api/v1/instagram", "POST", {
        id,
        kind: "post",
        brief: "Arte simulada para validar a publicação pela Zernio.",
        niche: "Serviços profissionais",
        format,
        use_logo: false,
      });
      assert.equal(created.response.status, 202);
      await ready(id);
      return id;
    };
    async function ready(id) {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        const result = await call(`/api/v1/instagram/${id}`);
        assert.equal(result.response.status, 200);
        if (result.data.status !== "generating") {
          assert.equal(result.data.status, "ready");
          return;
        }
        await pause(200);
      }
      throw new Error("The demo image did not complete.");
    }
    const intent = (
      itemIds,
      format = "feed",
      caption = "Publicação simulada de teste.",
      account = primaryAccount,
    ) => ({ id: randomUUID(), account_id: account, item_ids: itemIds, format, caption });
    const postsFor = async (id) =>
      (await state()).requests.filter(
        (entry) =>
          entry.path === "posts" &&
          entry.method === "POST" &&
          entry.body.metadata.studio_publication_id === id,
      );
    async function send(input, expected = "published") {
      const result = await call("/api/v1/instagram/publish", "POST", input);
      assert.equal(result.response.status, 200);
      assert.equal(result.data.status, expected);
      assert.equal((await postsFor(input.id)).length, 1);
      return result.data;
    }
    try {
      // Missing social credentials never disable generation or invent connected accounts.
      await boot();
      assert.equal((await call("/api/v1/instagram/config")).data.social.configured, false);
      assert.equal((await call("/api/v1/instagram/connections")).data.configured, false);
      assert.equal((await call("/api/v1/instagram/publish")).data.can_publish, false);
      assert.equal(
        (await call("/api/v1/instagram/connections", "POST", { action: "connect" })).response
          .status,
        503,
      );
      const feed = await create();
      assert.equal((await state()).requests.length, 0);
      await stop();

      // Only the server knows the key. Automatic profile creation is scoped and idempotent.
      await boot(keys[0]);
      assert.equal((await call("/api/v1/instagram/config")).data.social.configured, true);
      for (let index = 0; index < 2; index++) {
        const result = await call("/api/v1/instagram/connections");
        assert.equal(result.response.status, 200);
        assert.equal(result.data.configured, true);
        assert.equal(result.data.can_edit, true);
        assert.equal(result.data.accounts.length, 0);
      }
      assert.equal(
        (await state()).requests.filter(
          (entry) => entry.path === "profiles" && entry.method === "POST",
        ).length,
        1,
      );
      assert.equal((await state()).profiles.primary.externalId, "local");
      const connected = await call("/api/v1/instagram/connections", "POST", { action: "connect" });
      assert.equal(connected.response.status, 200);
      assert.equal(new URL(connected.data.auth_url).origin, "https://zernio.com");
      const connectRequest = (await state()).requests.findLast(
        (entry) => entry.path === "connect/instagram",
      );
      assert.equal(connectRequest.query.redirect_url, `${base}/app/connections`);
      const connections = (await call("/api/v1/instagram/connections")).data;
      assert.equal(
        connections.accounts.some((entry) => entry.id === foreignAccount),
        false,
      );
      assert.equal(connections.accounts.find((entry) => entry.id === primaryAccount).active, true);
      assert.equal((await call("/api/v1/instagram/account")).data.account.username, "studio_test");
      assert.equal((await call("/api/v1/instagram/publish")).data.can_publish, true);
      for (const action of ["connect", "disconnect"]) {
        const before = (await state()).requests.filter(
          (entry) =>
            (entry.path.startsWith("accounts/") && entry.method === "DELETE") ||
            entry.path === "connect/instagram",
        ).length;
        const result = await call("/api/v1/instagram/connections", "POST", {
          action,
          account_id: foreignAccount,
          ...(action === "disconnect" ? { confirmed: true } : {}),
        });
        assert.equal(result.response.status, 404);
        assert.equal(
          (await state()).requests.filter(
            (entry) =>
              (entry.path.startsWith("accounts/") && entry.method === "DELETE") ||
              entry.path === "connect/instagram",
          ).length,
          before,
        );
      }
      assert.equal(
        (
          await call("/api/v1/instagram/connections", "POST", {
            action: "connect",
            account_id: inactiveAccount,
          })
        ).response.status,
        200,
      );
      assert.equal(
        (await state()).requests.findLast((entry) => entry.path === "connect/instagram").query
          .reconnectAccountId,
        inactiveAccount,
      );
      assert.equal(
        (
          await call("/api/v1/instagram/connections", "POST", {
            action: "disconnect",
            account_id: inactiveAccount,
          })
        ).response.status,
        400,
      );
      assert.equal(
        (
          await call("/api/v1/instagram/connections", "POST", {
            action: "disconnect",
            account_id: inactiveAccount,
            confirmed: true,
          })
        ).response.status,
        200,
      );

      const browserTests = spawn(
        process.execPath,
        [
          require.resolve("@playwright/test/cli"),
          "test",
          "social.spec.mjs",
          "--config",
          "tests/e2e/playwright.config.mjs",
          "--output",
          "test-results/social-integration",
        ],
        {
          env: {
            ...process.env,
            STUDIO_TEST_URL: base,
            STUDIO_SOCIAL_E2E: "1",
            STUDIO_SOCIAL_E2E_ITEM: feed,
          },
          stdio: "inherit",
        },
      );
      const browserCode = await new Promise((resolve, reject) => {
        browserTests.on("error", reject);
        browserTests.on("exit", resolve);
      });
      assert.equal(browserCode, 0, "Social browser journeys pass against the simulated provider");

      const square = await create("square");
      const story = await create("story");
      const carousel = Array.from({ length: 8 }, () => randomUUID());
      const queued = await call("/api/v1/instagram/carousels", "POST", {
        id: randomUUID(),
        item_ids: carousel,
        template: "noticia_impacto_operacional",
        brief: "Explicar uma novidade e seus impactos práticos em oito slides.",
        niche: "Serviços profissionais",
        use_logo: false,
        format: "feed",
      });
      assert.equal(queued.response.status, 202);
      await Promise.all(carousel.map(ready));

      const feedIntent = intent([feed]);
      assert.ok((await send(feedIntent)).permalink.startsWith("https://www.instagram.com/"));
      const squareIntent = intent([square]);
      const storyIntent = intent([story], "story");
      await send(squareIntent);
      await send(storyIntent);
      const carouselIntent = intent(carousel, "carousel");
      await send(carouselIntent);
      const providerCarousel = (await postsFor(carouselIntent.id))[0];
      assert.equal(providerCarousel.body.mediaItems.length, 8);
      assert.equal(providerCarousel.idempotency_key, carouselIntent.id);
      assert.equal(providerCarousel.request_id, carouselIntent.id);
      const uploaded = (await state()).uploads;
      for (const upload of uploaded) {
        assert.equal(upload.method, "PUT");
        assert.equal(upload.format, "jpeg");
        assert.equal(upload.width, 1080);
        assert.equal(upload.content_type, "image/jpeg");
        assert.equal(upload.has_authorization, false);
      }
      assert.ok(uploaded.some((upload) => upload.height === 1350));
      assert.ok(uploaded.some((upload) => upload.height === 1080));
      assert.ok(uploaded.some((upload) => upload.height === 1920));
      for (const [input, height] of [
        [feedIntent, 1350],
        [squareIntent, 1080],
        [storyIntent, 1920],
        [carouselIntent, 1350],
      ]) {
        const remote = (await postsFor(input.id))[0].body;
        assert.equal(remote.mediaItems.length, input.item_ids.length);
        for (const media of remote.mediaItems) {
          const url = new URL(media.url);
          assert.equal(url.origin, "https://media.zernio.com");
          assert.equal(uploaded.find((upload) => upload.path === url.pathname)?.height, height);
        }
      }
      assert.equal(
        (await call("/api/v1/instagram/publish", "POST", feedIntent)).response.status,
        409,
      );
      assert.equal((await postsFor(feedIntent.id)).length, 1);
      const race = intent([feed], "feed", "Concorrência com a mesma intenção.");
      const raced = await Promise.all([
        call("/api/v1/instagram/publish", "POST", race),
        call("/api/v1/instagram/publish", "POST", race),
      ]);
      assert.deepEqual(raced.map((result) => result.response.status).sort(), [200, 409]);
      assert.equal((await postsFor(race.id)).length, 1);

      for (const scenario of ["timeout", "conflict"]) {
        const input = intent([feed], "feed", `[${scenario}] Resultado remoto perdido.`);
        const result = await send(input, "uncertain");
        assert.match(result.error, /confirma|resultado/i);
        assert.equal(
          (await call("/api/v1/instagram/publish", "POST", { ...input, id: randomUUID() })).response
            .status,
          409,
          "A different UUID cannot repeat the same unresolved content",
        );
        const refreshed = await call("/api/v1/instagram/publish");
        assert.equal(
          refreshed.data.publications.find((entry) => entry.id === input.id).status,
          "published",
        );
        assert.equal((await call("/api/v1/instagram/publish", "POST", input)).response.status, 409);
        assert.equal(
          (await postsFor(input.id)).length,
          1,
          "Reconciliation reads without resending",
        );
      }
      assert.match((await send(intent([feed], "feed", "[cancelled]"), "failed")).error, /cancel/i);
      assert.match((await send(intent([feed], "feed", "[failed]"), "failed")).error, /permiss/i);

      // A slow provider lookup must not overwrite a publication completed by another request.
      const raceId = randomUUID();
      const scope = createHash("sha256")
        .update(JSON.stringify([keys[0], ""]))
        .digest("hex");
      const preparing = {
        ...intent([feed]),
        id: raceId,
        scope,
        profile_id: "111111111111111111111111",
        owner_pid: server.pid,
        status: "preparing",
        provider_post_id: null,
        permalink: null,
        error: null,
        created_at: new Date().toISOString(),
      };
      const db = new DatabaseSync(join(directory, "data", "studio.sqlite"));
      try {
        db.prepare("INSERT INTO instagram_publications VALUES(?,?,?,?,?,?)").run(
          "local",
          raceId,
          scope,
          preparing.profile_id,
          preparing.status,
          JSON.stringify(preparing),
        );
        const delayed = await state();
        delayed.delay_profile_reads_ms = 300;
        delayed.hold_profile_reads = true;
        const before = delayed.requests.length;
        await writeFile(statePath, JSON.stringify(delayed));
        const updating = call("/api/v1/instagram/publish");
        const observedDeadline = Date.now() + 5000;
        let observed = false;
        while (Date.now() < observedDeadline) {
          const captured = await state();
          if (
            captured.requests
              .slice(before)
              .some((entry) => entry.path.startsWith("profiles/") && entry.method === "GET")
          ) {
            observed = true;
            break;
          }
          await pause(10);
        }
        assert.equal(observed, true, "The refresh is waiting for the provider lookup");
        const completed = {
          ...preparing,
          status: "published",
          provider_post_id: "post-concurrent-completion",
          permalink: "https://www.instagram.com/p/concurrent/",
        };
        db.prepare(
          "UPDATE instagram_publications SET status=?,value=? WHERE tenant=? AND id=?",
        ).run("published", JSON.stringify(completed), "local", raceId);
        const released = await state();
        released.hold_profile_reads = false;
        await writeFile(statePath, JSON.stringify(released));
        const refreshed = await updating;
        assert.equal(
          refreshed.data.publications.find((entry) => entry.id === raceId).status,
          "published",
        );
        const stored = db
          .prepare("SELECT status,value FROM instagram_publications WHERE tenant=? AND id=?")
          .get("local", raceId);
        assert.equal(stored.status, "published");
        assert.equal(JSON.parse(stored.value).status, "published");
        const resumed = await state();
        resumed.delay_profile_reads_ms = 0;
        await writeFile(statePath, JSON.stringify(resumed));
      } finally {
        db.close();
      }
      assert.equal(
        (
          await call(
            "/api/v1/instagram/publish",
            "POST",
            intent([feed], "feed", "Outra conta", foreignAccount),
          )
        ).response.status,
        404,
      );
      assert.equal(
        (await call("/api/v1/instagram/publish", "POST", intent([randomUUID()]))).response.status,
        422,
      );
      assert.equal(
        (await call("/api/v1/instagram/publish", "POST", intent([feed], "story"))).response.status,
        422,
      );

      const metrics = await call(`/api/v1/instagram/insights?account_id=${primaryAccount}`);
      assert.equal(metrics.data.insights.metrics.reach.total, 1200);
      assert.equal(
        (await call(`/api/v1/instagram/insights?account_id=${foreignAccount}`)).response.status,
        404,
      );
      const posts = (await call(`/api/v1/growth/instagram?account_id=${primaryAccount}`)).data
        .posts;
      assert.equal(posts[0].id, "17900000000000001");
      const automation = {
        action: "create",
        id: randomUUID(),
        rule: {
          name: "Material solicitado",
          account_id: primaryAccount,
          post_id: posts[0].id,
          keywords: ["quero"],
          match_mode: "contains",
          dm_response_template: "Aqui está o material solicitado.",
          comment_reply: "Enviei o material.",
        },
      };
      assert.equal(
        (await call("/api/v1/growth/instagram", "POST", automation)).response.status,
        400,
      );
      assert.equal((await state()).automations.length, 0);
      assert.equal(
        (await call("/api/v1/growth/instagram", "POST", { ...automation, confirmed: true }))
          .response.status,
        200,
      );
      const growth = (await call("/api/v1/growth/instagram")).data;
      assert.equal(growth.automations[0].stats.dmsSent, 4);
      const automationId = growth.automations[0].id;
      assert.equal(
        (await call(`/api/v1/growth/instagram?logs=${automationId}`)).data.logs[0].status,
        "sent",
      );
      assert.equal(
        (await call(`/api/v1/growth/instagram?logs=${foreignAccount}`)).response.status,
        404,
      );
      assert.equal(
        (
          await call("/api/v1/growth/instagram", "POST", {
            action: "toggle",
            id: automationId,
            is_active: false,
          })
        ).response.status,
        400,
      );
      assert.equal(
        (
          await call("/api/v1/growth/instagram", "POST", {
            action: "toggle",
            id: automationId,
            is_active: false,
            confirmed: true,
          })
        ).response.status,
        200,
      );
      await stop();

      // A restart recovers the same profile; removing the remote profile triggers safe recreation.
      await boot(keys[0]);
      await call("/api/v1/instagram/connections");
      assert.equal(
        (await state()).requests.filter(
          (entry) => entry.path === "profiles" && entry.method === "POST",
        ).length,
        1,
      );
      await stop();
      const removedProfile = await state();
      delete removedProfile.profiles.primary;
      await writeFile(statePath, JSON.stringify(removedProfile));
      await boot(keys[0]);
      assert.equal((await call("/api/v1/instagram/connections")).response.status, 200);
      assert.equal(
        (await state()).requests.filter(
          (entry) =>
            entry.path === "profiles" && entry.method === "POST" && entry.owner === "primary",
        ).length,
        2,
      );
      await stop();

      // Changing only the key chooses another provider namespace and permits reconnecting there.
      await boot(keys[1]);
      const rotated = await call("/api/v1/instagram/connections");
      assert.equal(rotated.data.accounts.length, 0);
      assert.equal(
        (await call("/api/v1/instagram/connections", "POST", { action: "connect" })).response
          .status,
        200,
      );
      const switchedAccounts = (await call("/api/v1/instagram/connections")).data.accounts;
      assert.equal(
        switchedAccounts.some((entry) => entry.id === rotatedAccount),
        true,
      );
      assert.equal(
        switchedAccounts.some((entry) => entry.id === primaryAccount),
        false,
      );
      assert.equal(
        (await call("/api/v1/instagram/publish", "POST", intent([feed]))).response.status,
        404,
      );
      await send(intent([feed], "feed", "Publicação depois da troca de chave.", rotatedAccount));
      await stop();
      await boot(keys[2]);
      const denied = await call("/api/v1/instagram/connections");
      assert.equal(denied.response.status, 401);
      assert.match(denied.error.message, /chave|credencial/i);
      const database = Buffer.concat(
        await Promise.all(
          ["studio.sqlite", "studio.sqlite-wal"].map(async (file) => {
            try {
              return await readFile(join(directory, "data", file));
            } catch (error) {
              if (error.code === "ENOENT") return Buffer.alloc(0);
              throw error;
            }
          }),
        ),
      );
      for (const key of keys) {
        assert.equal(logs.includes(key), false, "Server logs never include provider credentials");
        assert.equal(
          database.includes(Buffer.from(key)),
          false,
          "Local persistence stores a key fingerprint instead of the credential",
        );
      }
      console.info(
        JSON.stringify({
          event: "social_integration_verified",
          formats: ["feed", "square", "carousel-8", "story"],
          uncertain_reconciled_without_resend: 2,
          preparing_race_preserved: true,
          key_rotation: true,
          credentials_private: true,
        }),
      );
    } finally {
      await stop();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
