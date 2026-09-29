import "server-only";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import {
  createAi,
  createStudio,
  openAiTransport,
  type StudioItem,
  type StudioInput,
} from "@saraivabr/instagram-studio-kit";
import sharp from "sharp";
const directory = join(process.cwd(), ".studio-data");
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
const repository = {
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
const escape = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
const mock = async (path: string, body: Record<string, unknown>) => {
  if (path.startsWith("images/")) {
    const size = String(body.size).split("x").map(Number);
    const [width, height] = size as [number, number];
    const prompt = String(body.prompt);
    const title = escape(
      (
        prompt.match(/Pedido: ([\s\S]*?)\. Use a identidade/)?.[1] ??
        "Sua ideia ganha forma"
      ).slice(0, 100),
    );
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#f3f1ec"/><circle cx="${width * 0.85}" cy="${height * 0.22}" r="${width * 0.4}" fill="#c8d6c1"/><rect x="70" y="${height * 0.5}" width="${width - 140}" height="${height * 0.3}" rx="32" fill="#41573b"/><text x="85" y="115" font-family="sans-serif" font-size="26" fill="#506d48">STUDIO · DEMONSTRAÇÃO</text><text x="85" y="${height * 0.56}" font-family="sans-serif" font-size="32" fill="white">Conteúdo para seu negócio</text><foreignObject x="85" y="${height * 0.6}" width="${width - 180}" height="${height * 0.18}"><div xmlns="http://www.w3.org/1999/xhtml" style="font:24px sans-serif;color:white;line-height:1.5">${title}</div></foreignObject><text x="85" y="${height - 75}" font-family="sans-serif" font-size="24" fill="#5d594f">Arte simulada · sem geração de IA</text></svg>`;
    const bytes = await sharp(Buffer.from(svg)).png().toBuffer();
    return { data: [{ b64_json: bytes.toString("base64") }] };
  }
  if (body.tools)
    throw new Error(
      "Pesquisa real requer credencial e modelo configurados no servidor.",
    );
  return {
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: "[Demonstração] Organize suas ideias e transforme conhecimento em conteúdo útil. Qual é o próximo passo para seu negócio?",
          },
        ],
      },
    ],
  };
};
const configured = !!process.env.OPENAI_API_KEY;
const transport = configured
  ? openAiTransport(process.env.OPENAI_API_KEY!)
  : mock;
const ai = createAi(transport, {
  image: process.env.OPENAI_IMAGE_MODEL || "mock",
  text: process.env.OPENAI_TEXT_MODEL || "mock",
});
export const studio = createStudio({
  ai,
  repository,
  assets: {
    async save(tenant, id, bytes) {
      await mkdir(join(directory, tenant), { recursive: true });
      await writeFile(join(directory, tenant, `${id}.png`), bytes);
      return `${tenant}/${id}.png`;
    },
  },
});
export function present(item: StudioItem) {
  return {
    ...item,
    can_edit: true,
    image_url: item.asset_path ? `/api/assets/${item.id}` : null,
  };
}
export async function list() {
  return Object.entries(await records())
    .filter(([key]) => JSON.parse(key)[0] === "local")
    .map(([, item]) => present(item))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}
export async function getItem(id: string) {
  return (await list()).find((item) => item.id === id);
}
export async function editItem(id: string, caption: string) {
  return present(await repository.complete("local", id, { caption }));
}
export async function deleteReference(id: string) {
  return mutate((items) => {
    const key = JSON.stringify(["local", id]);
    if (items[key]?.kind !== "reference")
      throw new Error("Somente referências podem ser removidas.");
    delete items[key];
    return true;
  });
}
export async function image(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("ID inválido.");
  return readFile(join(directory, "local", `${id}.png`));
}
