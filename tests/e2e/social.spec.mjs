import { test, expect } from "@playwright/test";

test.skip(process.env.STUDIO_SOCIAL_E2E !== "1", "Runs against the isolated Zernio fetch fixture");

test("a professional Instagram account connects through the real app routes", async ({
  page,
}, testInfo) => {
  const messages = [];
  page.on("console", (message) => messages.push(message.text()));
  await page.route("https://media.zernio.com/**", (route) => route.fulfill({ status: 204 }));
  let authorizations = 0;
  await page.route("https://zernio.com/connect/mock?**", async (route) => {
    authorizations++;
    const authorization = new URL(route.request().url());
    const callback = new URL(authorization.searchParams.get("redirect_url"));
    callback.searchParams.set("connected", "instagram");
    callback.searchParams.set("accountId", authorization.searchParams.get("accountId"));
    callback.searchParams.set("username", authorization.searchParams.get("username"));
    await route.fulfill({ status: 302, headers: { location: callback.toString() } });
  });
  await page.goto("/app/connections");
  await expect(
    page.getByRole("heading", { name: "Conecte seu Instagram.", exact: true }),
  ).toBeVisible();
  const connect = page.getByRole("button", { name: "Conectar Instagram", exact: true });
  await expect(connect).toBeEnabled();
  await connect.click();
  await expect(page).toHaveURL(/\/app\/connections\?connected=instagram/);
  await expect(
    page.getByText("Autorização concluída. Confira o estado da sua conta abaixo.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "@studio_test", exact: true })).toBeVisible();
  expect(authorizations).toBe(1);
  expect((await page.content()).includes("studio-test-key")).toBe(false);
  expect(messages.some((message) => message.includes("studio-test-key"))).toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.body.scrollWidth > window.innerWidth + 1)).toBe(false);
  const screenshot = testInfo.outputPath("instagram-connected-mobile.png");
  await page.screenshot({ path: screenshot, fullPage: true, animations: "disabled" });
  await testInfo.attach("instagram-connected-mobile", {
    path: screenshot,
    contentType: "image/png",
  });
});

test("reviewing and confirming a publication sends once; refreshing only reads", async ({
  page,
}, testInfo) => {
  const item = process.env.STUDIO_SOCIAL_E2E_ITEM;
  expect(item).toMatch(/^[a-f0-9-]{36}$/);
  const mutations = [];
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === "/api/v1/instagram/publish" &&
      request.method() === "POST"
    )
      mutations.push(request.postDataJSON());
  });
  await page.route("https://media.zernio.com/**", (route) => route.fulfill({ status: 204 }));
  await page.goto(`/app/instagram/posts/${item}`);
  const publish = page
    .getByRole("heading", { name: "Publicar no Instagram", exact: true })
    .locator("..");
  await expect(
    publish.getByRole("button", { name: "Revisar publicação", exact: true }),
  ).toBeEnabled();
  await publish.getByRole("button", { name: "Revisar publicação", exact: true }).click();
  const confirm = publish.getByRole("button", { name: "Confirmar publicação", exact: true });
  await expect(confirm).toBeVisible();
  expect(mutations).toHaveLength(0);
  const sent = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/instagram/publish" &&
      response.request().method() === "POST",
  );
  await confirm.click();
  expect((await sent).status()).toBe(200);
  await expect(publish.getByText("Publicado", { exact: true })).toBeVisible();
  await expect(
    publish.getByRole("link", { name: "Ver no Instagram", exact: true }),
  ).toHaveAttribute("href", /^https:\/\/www\.instagram\.com\//);
  expect(mutations).toHaveLength(1);
  const refreshed = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/instagram/publish" &&
      response.request().method() === "GET",
  );
  await publish.getByRole("button", { name: "Atualizar resultado", exact: true }).click();
  expect((await refreshed).status()).toBe(200);
  await page.reload();
  await expect(page.getByText("Publicado", { exact: true })).toBeVisible();
  expect(mutations).toHaveLength(1);
  expect((await page.content()).includes("studio-test-key")).toBe(false);
  const screenshot = testInfo.outputPath("instagram-published.png");
  await page.screenshot({ path: screenshot, fullPage: true, animations: "disabled" });
  await testInfo.attach("instagram-published", { path: screenshot, contentType: "image/png" });
});
