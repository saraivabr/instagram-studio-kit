import "server-only";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import type { StudioItem, StudioInput } from "@saraivabr/instagram-studio-kit";
import { dataDirectory as directory } from "./paths";
type Records = Record<string, StudioItem>;
const state = globalThis as typeof globalThis & {
  studioQueue?: Promise<unknown>;
};
export async function records(): Promise<Records> {
  try {
    return JSON.parse(await readFile(join(directory, "items.json"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}
async function mutate<T>(fn: (items: Records) => T): Promise<T> {
  const task = (state.studioQueue ?? Promise.resolve()).then(async () => {
    const items = await records();
    const result = fn(items);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "items.tmp"), JSON.stringify(items));
    await rename(join(directory, "items.tmp"), join(directory, "items.json"));
    return result;
  });
  state.studioQueue = task.catch(() => {});
  return task;
}
export const repository = {
  async claim(tenant: string, input: StudioInput) {
    return mutate((items) => {
      const key = JSON.stringify([tenant, input.id]);
      if (items[key]) return { created: false, item: items[key]! };
      const now = new Date().toISOString();
      const item: StudioItem = {
        id: input.id,
        kind: input.kind,
        input,
        status: "generating",
        caption: "",
        answer: "",
        sources: [],
        asset_path: null,
        error: null,
        created_at: now,
        updated_at: now,
      };
      items[key] = item;
      return { created: true, item };
    });
  },
  async complete(tenant: string, id: string, changes: Partial<StudioItem>) {
    return mutate((items) => {
      const key = JSON.stringify([tenant, id]);
      if (!items[key]) throw new Error("Item não encontrado.");
      return (items[key] = {
        ...items[key]!,
        ...changes,
        updated_at: new Date().toISOString(),
      });
    });
  },
};
export async function deleteReference(id: string) {
  return mutate((items) => {
    const key = JSON.stringify(["local", id]);
    if (items[key]?.kind !== "reference")
      throw new Error("Somente referências podem ser removidas.");
    delete items[key];
    return true;
  });
}
