import { test, expect } from "@playwright/test";
import sharp from "sharp";

test("a person is added with consent, offered in creation and removed", async ({ page }) => {
  const photo = await sharp({
    create: { width: 400, height: 500, channels: 3, background: { r: 190, g: 150, b: 130 } },
  })
    .jpeg()
    .toBuffer();
  await page.goto("/app/settings/marca");
  await expect(page.getByRole("heading", { name: "Pessoas da marca" })).toBeVisible();
  await expect(page.getByText("O rosto é aproximado, não idêntico")).toBeVisible();
  await page.locator("#person-name").fill("Bruno Lima");
  await page
    .getByLabel("Fotos da pessoa")
    .setInputFiles({ name: "bruno.jpg", mimeType: "image/jpeg", buffer: photo });
  await expect(page.getByText("1 foto escolhida")).toBeVisible();
  const submit = page.getByRole("button", { name: "Adicionar pessoa", exact: true });
  await expect(submit).toBeDisabled();
  await page.getByLabel("Tenho autorização desta pessoa para usar a imagem dela.").check();
  await submit.click();
  await expect(page.getByText("Pessoa adicionada.")).toBeVisible();
  await expect(page.getByAltText("Foto 1 de Bruno Lima")).toBeVisible();

  await page.goto("/app/instagram/new");
  await expect(page.getByRole("radio", { name: "Incluir Bruno Lima na arte" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Sem pessoa" })).toBeChecked();

  await page.goto("/app/settings/marca");
  await page.getByRole("button", { name: "Remover", exact: true }).last().click();
  await expect(page.getByText("Pessoa e fotos removidas.")).toBeVisible();
  await expect(page.getByText("Nenhuma pessoa cadastrada ainda.")).toBeVisible();
});
