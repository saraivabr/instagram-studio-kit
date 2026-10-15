import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";

const accountId = "a".repeat(24);
const account = { id: accountId, username: "padaria_exemplo", avatar_url: null, active: true };
const connectionsPath = /\/api\/v1\/instagram\/connections(?:\?.*)?$/;
const growthPath = /\/api\/v1\/growth\/instagram(?:\?.*)?$/;

async function fulfill(route, data) {
  await route.fulfill({ json: { data } });
}

test("connections explains missing server configuration on mobile", async ({ page }, testInfo) => {
  await page.route(connectionsPath, (route) =>
    fulfill(route, {
      configured: false,
      accounts: [],
      can_edit: false,
      message: "Configure a integração do Instagram no servidor para conectar sua conta.",
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/connections?aba=sociais");
  await expect(page.getByRole("heading", { name: "Conecte seu Instagram." })).toBeVisible();
  await expect(
    page.getByText("Configure a integração do Instagram no servidor para conectar sua conta."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Conectar Instagram", exact: true }),
  ).toBeDisabled();
  await expect(page.getByText(/As credenciais ficam somente no servidor/)).toBeVisible();
  expect(await page.evaluate(() => document.body.scrollWidth > window.innerWidth + 1)).toBe(false);
  const screenshot = testInfo.outputPath("connections-mobile.png");
  await page.screenshot({ path: screenshot, fullPage: true, animations: "disabled" });
  await testInfo.attach("connections-mobile", { path: screenshot, contentType: "image/png" });
});

test("OAuth feedback is translated and never displays the raw query error", async ({ page }) => {
  let reads = 0;
  await page.route(connectionsPath, async (route) => {
    reads++;
    await fulfill(route, { configured: true, accounts: [], can_edit: true });
  });
  const rawError = "credential-must-never-appear-in-the-interface";
  await page.goto(`/app/connections?error=oauth_denied&error_message=${rawError}`);
  await expect(
    page.getByText(
      "A conexão foi cancelada ou não recebeu autorização. Você pode tentar novamente.",
    ),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText(rawError);
  await page.goto(`/app/connections?error=unknown&error_message=${rawError}`);
  await expect(
    page.getByText("Não foi possível concluir a conexão. Tente novamente."),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText(rawError);
  await page.goto("/app/connections?connected=instagram");
  await expect(
    page.getByText("Autorização concluída. Confira o estado da sua conta abaixo."),
  ).toBeVisible();
  await expect(
    page.getByText("Nenhuma conta do Instagram conectada a esta instalação."),
  ).toBeVisible();
  expect(reads).toBeGreaterThanOrEqual(3);
});

test("disconnect requires confirmation and refreshes the account list", async ({ page }) => {
  const writes = [];
  let accounts = [account];
  await page.route(connectionsPath, async (route) => {
    if (route.request().method() === "POST") {
      writes.push(route.request().postDataJSON());
      accounts = [];
      await fulfill(route, { disconnected: true });
    } else {
      await fulfill(route, { configured: true, accounts, can_edit: true });
    }
  });
  await page.goto("/app/connections");
  await expect(page.getByText("@padaria_exemplo", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Desconectar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirmar desconexão" })).toBeVisible();
  expect(writes).toHaveLength(0);
  await page.getByRole("button", { name: "Manter conectada" }).click();
  expect(writes).toHaveLength(0);
  await page.getByRole("button", { name: "Desconectar", exact: true }).click();
  await page.getByRole("button", { name: "Confirmar desconexão" }).click();
  await expect(page.getByText("Conta desconectada desta instalação.")).toBeVisible();
  await expect(
    page.getByText("Nenhuma conta do Instagram conectada a esta instalação."),
  ).toBeVisible();
  expect(writes).toEqual([{ action: "disconnect", account_id: accountId, confirmed: true }]);
});

test("reconnect includes the selected account before opening authorization", async ({ page }) => {
  const writes = [];
  const authorization = "https://authorization.example.test/instagram";
  await page.route("https://authorization.example.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Autorização de teste</h1>",
    }),
  );
  await page.route(connectionsPath, async (route) => {
    if (route.request().method() === "POST") {
      writes.push(route.request().postDataJSON());
      await fulfill(route, { auth_url: authorization });
    } else {
      await fulfill(route, {
        configured: true,
        accounts: [{ ...account, active: false }],
        can_edit: true,
      });
    }
  });
  await page.goto("/app/connections");
  await page.getByRole("button", { name: "Reconectar", exact: true }).click();
  await expect(page).toHaveURL(authorization);
  expect(writes).toEqual([{ action: "connect", account_id: accountId }]);
});

test("automations and insights explain missing social configuration", async ({ page }) => {
  const message = "Configure a integração social no servidor para usar o Instagram.";
  await page.route(growthPath, (route) =>
    fulfill(route, { accounts: [], automations: [], can_edit: false, message }),
  );
  await page.route(/\/api\/v1\/instagram\/insights(?:\?.*)?$/, (route) =>
    fulfill(route, { connected: false, accounts: [], message }),
  );
  await page.goto("/app/instagram/growth");
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Nova automação", exact: true })).toBeDisabled();
  await page.goto("/app/instagram/insights");
  await expect(page.getByText(message, { exact: true })).toBeVisible();
});

test("automation changes wait for an explicit Direct confirmation", async ({ page }) => {
  const writes = [];
  const automations = [];
  await page.route(growthPath, async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const body = request.postDataJSON();
      writes.push(body);
      if (body.action === "create")
        automations.push({
          id: "b".repeat(24),
          name: body.rule.name,
          accountId,
          platformPostId: "12345_67890",
          postTitle: "Postagem de exemplo",
          keywords: body.rule.keywords,
          matchMode: "word",
          dmMessage: body.rule.dm_response_template,
          commentReply: "",
          isActive: true,
          stats: { dmsSent: 0, dmsFailed: 0, read: 0 },
        });
      else if (body.action === "toggle") automations[0].isActive = body.is_active;
      else if (body.action === "edit") automations[0].name = body.rule.name;
      await fulfill(route, {});
    } else if (new URL(request.url()).searchParams.has("account_id")) {
      await fulfill(route, { posts: [{ id: "12345_67890", message: "Postagem de exemplo" }] });
    } else {
      await fulfill(route, { accounts: [account], automations, can_edit: true });
    }
  });
  await page.goto("/app/instagram/growth");
  await page.getByRole("button", { name: "Nova automação", exact: true }).click();
  await page.getByLabel("Nome da automação", { exact: true }).fill("Materiais da padaria");
  await page
    .getByRole("combobox", { name: "Postagem que receberá os comentários", exact: true })
    .selectOption("12345_67890");
  await page.getByLabel("Palavras-chave, separadas por vírgula", { exact: true }).fill("QUERO");
  await page
    .getByLabel("Mensagem no Direct", { exact: true })
    .fill("Confira o material que você pediu.");
  await page.getByRole("button", { name: "Revisar ativação", exact: true }).click();
  await expect(
    page.getByText(/Ela ficará ativa e poderá enviar mensagens reais por Direct/),
  ).toBeVisible();
  expect(writes).toHaveLength(0);
  await page.getByRole("button", { name: "Confirmar e ativar", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Materiais da padaria", exact: true }),
  ).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ action: "create", confirmed: true });
  await page.getByRole("button", { name: "Pausar", exact: true }).click();
  expect(writes).toHaveLength(1);
  await page.getByRole("button", { name: "Confirmar pausa", exact: true }).click();
  await expect(page.getByRole("button", { name: "Ativar", exact: true })).toBeVisible();
  expect(writes[1]).toMatchObject({ action: "toggle", is_active: false, confirmed: true });
  await page.getByRole("button", { name: "Ativar", exact: true }).click();
  await expect(
    page.getByText(/Ela ficará ativa e poderá enviar mensagens reais por Direct/),
  ).toBeVisible();
  expect(writes).toHaveLength(2);
  await page.getByRole("button", { name: "Voltar à revisão", exact: true }).click();
  expect(writes).toHaveLength(2);
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  await page.getByLabel("Nome da automação", { exact: true }).fill("Materiais revisados");
  await page.getByRole("button", { name: "Revisar alterações", exact: true }).click();
  await expect(
    page.getByText(/Se ela estiver ativa, poderá enviar mensagens reais por Direct/),
  ).toBeVisible();
  expect(writes).toHaveLength(2);
  await page.getByRole("button", { name: "Confirmar alterações", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Materiais revisados", exact: true }),
  ).toBeVisible();
  expect(writes[2]).toMatchObject({ action: "edit", confirmed: true });
});

test("publication refresh only reads the result and never repeats the publish POST", async ({
  page,
  request,
}, testInfo) => {
  const configuration = await (await request.get("/api/v1/instagram/config")).json();
  test.skip(
    configuration.data?.mode !== "demo",
    "This check creates one isolated demo item, never a paid image.",
  );
  const id = randomUUID();
  const origin = new URL(testInfo.project.use.baseURL).origin;
  const created = await request.post("/api/v1/instagram", {
    headers: { Origin: origin },
    data: {
      id,
      kind: "post",
      brief: "Mostrar os bastidores reais de uma padaria artesanal.",
      niche: "Padaria artesanal",
      format: "feed",
      use_logo: false,
      caption: "",
    },
  });
  expect(created.ok()).toBe(true);
  await expect
    .poll(async () => (await (await request.get(`/api/v1/instagram/${id}`)).json()).data?.status, {
      timeout: 30_000,
    })
    .toBe("ready");
  let reads = 0;
  const writes = [];
  await page.route(/\/api\/v1\/instagram\/publish(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "POST") {
      writes.push(route.request().postDataJSON());
      await route.fulfill({
        status: 409,
        json: { error: { message: "Uma publicação anterior já foi enviada." } },
      });
    } else {
      reads++;
      await fulfill(route, {
        accounts: [account],
        can_publish: true,
        publications: [
          {
            id: randomUUID(),
            account_id: accountId,
            item_ids: [id],
            format: "feed",
            caption: "Legenda de teste",
            status: "pending",
            provider_post_id: null,
            permalink: null,
            error: null,
            created_at: new Date().toISOString(),
          },
        ],
      });
    }
  });
  await page.goto(`/app/instagram/posts/${id}`);
  await expect(page.getByText("Processando no Instagram", { exact: true })).toBeVisible();
  const previousReads = reads;
  await page.getByRole("button", { name: "Atualizar resultado", exact: true }).click();
  await expect.poll(() => reads).toBeGreaterThan(previousReads);
  expect(writes).toHaveLength(0);
});
