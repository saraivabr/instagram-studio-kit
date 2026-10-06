import { test, expect } from "@playwright/test";

test("creation preserves the grid, cards and typography on desktop and mobile", async ({
  page,
}, testInfo) => {
  const response = await page.goto("/app/instagram/new");
  expect(response.headers()["x-powered-by"]).toBeUndefined();
  expect(response.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");

  const title = page.getByRole("heading", { name: "O que você quer contar?" });
  await expect(title).toBeVisible();
  await expect(page.locator("form")).toHaveCSS("display", "grid");
  const formStyle = await page.locator("form").evaluate((element) => {
    const style = getComputedStyle(element);
    return { columns: style.gridTemplateColumns.split(" ").length, gap: style.gap };
  });
  expect(formStyle.columns).toBe(2);
  expect(parseFloat(formStyle.gap)).toBeGreaterThanOrEqual(32);
  await expect(page.locator("form section").first()).toHaveCSS("border-radius", "24px");
  await expect(page.locator("form section").first()).toHaveCSS("border-top-width", "1px");
  const titleSize = await title.evaluate((element) =>
    parseFloat(getComputedStyle(element).fontSize),
  );
  expect(titleSize).toBeGreaterThanOrEqual(40);
  const desktopScreenshot = testInfo.outputPath("create-desktop.png");
  await page.screenshot({ path: desktopScreenshot, fullPage: true, animations: "disabled" });
  await testInfo.attach("create-desktop", {
    path: desktopScreenshot,
    contentType: "image/png",
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(title).toBeVisible();
  expect(
    await page
      .locator("form")
      .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length),
  ).toBe(1);
  const overflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  const mobileScreenshot = testInfo.outputPath("create-mobile.png");
  await page.screenshot({ path: mobileScreenshot, fullPage: true, animations: "disabled" });
  await testInfo.attach("create-mobile", {
    path: mobileScreenshot,
    contentType: "image/png",
  });
});

test("a demo creation can be reviewed, edited and downloaded", async ({ page }) => {
  await page.goto("/app/instagram/new");
  await page
    .locator("#brief")
    .fill("Divulgar a padaria artesanal com uma imagem de pão de fermentação natural.");
  if (!(await page.locator("#niche").isVisible())) {
    await page.getByText("Ajustar contexto da empresa", { exact: true }).click();
  }
  await page.locator("#niche").fill("Padaria artesanal de bairro");
  await page.getByRole("button", { name: "Gerar imagem e legenda", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/instagram\/posts\/[a-f0-9-]+$/);
  const caption = page.locator("#caption");
  await expect(caption).toBeEnabled({ timeout: 30_000 });
  await caption.fill("Legenda editada no teste do estúdio.");
  const saving = page.waitForResponse((response) => response.request().method() === "PATCH");
  await page.getByRole("button", { name: "Salvar legenda", exact: true }).click();
  expect((await saving).ok()).toBe(true);
  await page.reload();
  await expect(caption).toHaveValue("Legenda editada no teste do estúdio.");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Baixar imagem", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
});

test("eight carousel slides retain a four-column thumbnail grid", async ({ page }, testInfo) => {
  await page.goto("/app/instagram/new");
  await page
    .locator("#brief")
    .fill(
      "Apresentar uma novidade de IA e explicar seus possíveis usos na padaria, sem inventar fatos ou resultados.",
    );
  const context = page.locator("#niche");
  if (!(await context.isVisible())) {
    await page.getByText("Ajustar contexto da empresa", { exact: true }).click();
  }
  await context.fill("Padaria artesanal");
  await page.getByRole("radio", { name: /Da notícia ao impacto no negócio/ }).check();
  await page.getByRole("button", { name: "Gerar carrossel de 8 slides", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/instagram\/posts\/[a-f0-9-]+$/);
  await expect(page.getByText("8/8 slides prontos para revisão", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  const thumbnails = page.locator("div.grid-cols-4");
  await expect(thumbnails).toHaveCSS("display", "grid");
  expect(
    await thumbnails.evaluate(
      (element) => getComputedStyle(element).gridTemplateColumns.split(" ").length,
    ),
  ).toBe(4);
  await expect(thumbnails.locator("img")).toHaveCount(8);
  await expect(thumbnails.locator("img").first()).toHaveCSS("aspect-ratio", "4 / 5");
  const carouselScreenshot = testInfo.outputPath("carousel-review.png");
  await page.screenshot({ path: carouselScreenshot, fullPage: true, animations: "disabled" });
  await testInfo.attach("carousel-review", {
    path: carouselScreenshot,
    contentType: "image/png",
  });
});
