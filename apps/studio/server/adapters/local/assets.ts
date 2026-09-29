import "server-only";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AssetStore } from "@saraivabr/instagram-studio-kit";
import { dataDirectory } from "./paths";
export const localAssets: AssetStore = {
  async save(tenant, id, bytes) {
    await mkdir(join(dataDirectory, tenant), { recursive: true });
    await writeFile(join(dataDirectory, tenant, `${id}.png`), bytes);
    return `${tenant}/${id}.png`;
  },
};
export async function image(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("ID inválido.");
  return readFile(join(dataDirectory, "local", `${id}.png`));
}
