import { createSchema, type StudioInput, type StudioItem } from "../domain/schema.js";
import { createAi, type CompanyContext, type Logo } from "../providers/openai/ai.js";
export interface StudioRepository {
  /** Atomic insert-if-absent on (tenantId,input.id). Return existing on conflict. */
  claim(tenantId: string, input: StudioInput): Promise<{ created: boolean; item: StudioItem }>;
  complete(tenantId: string, id: string, changes: Partial<StudioItem>): Promise<StudioItem>;
}
export interface AssetStore {
  /** Save privately; return a path/key, never a public credential. */
  save(
    tenantId: string,
    id: string,
    bytes: Uint8Array,
    options?: { format?: "feed" | "square" | "story" },
  ): Promise<string>;
}
export interface StudioListQuery {
  limit?: number;
  cursor?: string;
  kind?: StudioItem["kind"];
  status?: StudioItem["status"];
  carousel_id?: string;
}
export interface StudioPage {
  items: StudioItem[];
  meta: { cursor: string | null; has_more: boolean; total: number };
}
/** Read/edit ports for a host API. Every operation must enforce tenant isolation. */
export interface StudioReadRepository extends StudioRepository {
  get(tenantId: string, id: string): Promise<StudioItem | undefined>;
  list(tenantId: string, query?: StudioListQuery): Promise<StudioPage>;
  updateCaption(tenantId: string, id: string, caption: string): Promise<StudioItem>;
  archive(tenantId: string, id: string): Promise<boolean>;
}
/** Resolve tenantId and brand from the authenticated session in the host backend. */
export function createStudio(deps: {
  ai: ReturnType<typeof createAi>;
  repository: StudioRepository;
  assets: AssetStore;
}) {
  function validateLogo(input: StudioInput, logo?: Logo) {
    if (input.kind === "post" && input.use_logo && logo) {
      const signature = Buffer.from(logo.bytes.subarray(0, 8)).toString("hex");
      const png = signature === "89504e470d0a1a0a";
      const jpeg = signature.startsWith("ffd8ff");
      if (
        logo.bytes.length > 5_000_000 ||
        !((logo.type === "image/png" && png) || (logo.type === "image/jpeg" && jpeg))
      )
        throw new Error("Logo inválido: envie PNG/JPG de até 5 MB.");
    }
  }
  async function generate(tenantId: string, raw: unknown, company?: CompanyContext, logo?: Logo) {
    if (!tenantId.trim()) throw new Error("Organização autenticada obrigatória.");
    const input = createSchema.parse(raw);
    try {
      validateLogo(input, logo);
      if (input.kind === "reference")
        return await deps.repository.complete(tenantId, input.id, {
          status: "ready",
        });
      if (input.kind === "research") {
        const result = await deps.ai.research(tenantId, input);
        return await deps.repository.complete(tenantId, input.id, {
          ...result,
          status: "ready",
        });
      }
      const caption =
        input.carousel && input.carousel.slide > 1
          ? ""
          : await deps.ai.createCaption(tenantId, input, company);
      const bytes = await deps.ai.createImage(
        tenantId,
        input,
        company,
        input.use_logo ? logo : undefined,
      );
      const asset_path = await deps.assets.save(tenantId, input.id, bytes, {
        format: input.format,
      });
      return await deps.repository.complete(tenantId, input.id, {
        caption,
        asset_path,
        status: "ready",
      });
    } catch (error) {
      await deps.repository.complete(tenantId, input.id, {
        status: "failed",
        error: "Pedido interrompido. Confira o histórico antes de gerar novamente.",
      });
      throw error;
    }
  }
  return {
    /** A durable worker may call this only after atomically claiming its job. */
    generateClaimed: generate,
    async create(tenantId: string, raw: unknown, company?: CompanyContext, logo?: Logo) {
      if (!tenantId.trim()) throw new Error("Organização autenticada obrigatória.");
      const input = createSchema.parse(raw);
      validateLogo(input, logo);
      const claimed = await deps.repository.claim(tenantId, input);
      if (!claimed.created) return claimed.item;
      return generate(tenantId, input, company, logo);
    },
  };
}
