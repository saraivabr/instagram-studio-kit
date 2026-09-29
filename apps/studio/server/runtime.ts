import "server-only";
import {
  createAi,
  createStudio,
  openAiTransport,
  type StudioItem,
} from "@saraivabr/instagram-studio-kit";
import { repository, records } from "./adapters/local/repository";
import { localAssets } from "./adapters/local/assets";
import { mockAiRequest } from "./adapters/demo/ai";
export { deleteReference } from "./adapters/local/repository";
export { image } from "./adapters/local/assets";
const configured = !!process.env.OPENAI_API_KEY;
const transport = configured
  ? openAiTransport(process.env.OPENAI_API_KEY!)
  : mockAiRequest;
const ai = createAi(transport, {
  image: process.env.OPENAI_IMAGE_MODEL || "mock",
  text: process.env.OPENAI_TEXT_MODEL || "mock",
});

export const studio = createStudio({ ai, repository, assets: localAssets });
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
