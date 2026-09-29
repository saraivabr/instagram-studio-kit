import { createSchema, type StudioInput, type StudioItem } from "./schema.js";
import { createAi, type CompanyContext, type Logo } from "./ai.js";
export interface StudioRepository {
  /** Atomic insert-if-absent on (tenantId,input.id). Return existing on conflict. */
  claim(
    tenantId: string,
    input: StudioInput,
  ): Promise<{ created: boolean; item: StudioItem }>;
  complete(
    tenantId: string,
    id: string,
    changes: Partial<StudioItem>,
  ): Promise<StudioItem>;
}
export interface AssetStore {
  /** Save privately; return a path/key, never a public credential. */
  save(tenantId: string, id: string, bytes: Uint8Array): Promise<string>;
}
/** Resolve tenantId and brand from the authenticated session in the host backend. */
export function createStudio(deps: {
  ai: ReturnType<typeof createAi>;
  repository: StudioRepository;
  assets: AssetStore;
}) {
  return {
    async create(
      tenantId: string,
      raw: unknown,
      company?: CompanyContext,
      logo?: Logo,
    ) {
      if (!tenantId.trim())
        throw new Error("Organização autenticada obrigatória.");
      const input = createSchema.parse(raw);
      if (input.kind === "post" && input.use_logo && logo) {
        const signature = Buffer.from(logo.bytes.subarray(0, 8)).toString(
          "hex",
        );
        const png = signature === "89504e470d0a1a0a";
        const jpeg = signature.startsWith("ffd8ff");
        if (
          logo.bytes.length > 5_000_000 ||
          !(
            (logo.type === "image/png" && png) ||
            (logo.type === "image/jpeg" && jpeg)
          )
        )
          throw new Error("Logo inválido: envie PNG/JPG de até 5 MB.");
      }
      const claimed = await deps.repository.claim(tenantId, input);
      if (!claimed.created) return claimed.item;
      try {
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
        const asset_path = await deps.assets.save(tenantId, input.id, bytes);
        return await deps.repository.complete(tenantId, input.id, {
          caption,
          asset_path,
          status: "ready",
        });
      } catch (error) {
        await deps.repository.complete(tenantId, input.id, {
          status: "failed",
          error:
            "Pedido interrompido. Confira o histórico antes de gerar novamente.",
        });
        throw error;
      }
    },
  };
}
