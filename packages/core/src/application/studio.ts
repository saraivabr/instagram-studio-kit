import { createSchema, studioId, type StudioInput, type StudioItem } from "../domain/schema.js";
import {
  createAi,
  maxPersonPhotos,
  type BrandPerson,
  type CompanyContext,
  type Logo,
} from "../providers/openai/ai.js";
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
    options?: {
      format?: "feed" | "square" | "story";
      /** Original logo to apply on top of the finished art (company.logoMode === "stamp"). */
      logo?: Logo;
    },
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
/** ISO 8601 instant with a time zone, as `Date.prototype.toISOString` writes it. */
const isoInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
function studioIdOf(raw: unknown) {
  const id = studioId.safeParse((raw as { id?: unknown } | null)?.id);
  return id.success ? id.data : undefined;
}
/** Resolve tenantId and brand from the authenticated session in the host backend. */
function validImage(image: Logo) {
  const signature = Buffer.from(image.bytes.subarray(0, 8)).toString("hex");
  const png = signature === "89504e470d0a1a0a";
  const jpeg = signature.startsWith("ffd8ff");
  return (
    image.bytes.length <= 5_000_000 &&
    ((image.type === "image/png" && png) || (image.type === "image/jpeg" && jpeg))
  );
}
export function createStudio(deps: {
  ai: ReturnType<typeof createAi>;
  repository: StudioRepository;
  assets: AssetStore;
}) {
  function validateLogo(input: StudioInput, logo?: Logo) {
    if (input.kind === "post" && input.use_logo && logo && !validImage(logo))
      throw new Error("Logo inválido: envie PNG/JPG de até 5 MB.");
  }
  /** A requested person must be the one supplied, with recorded consent and 1 to 3 valid photos. Never silently drop it. */
  function validatePerson(input: StudioInput, person?: BrandPerson) {
    if (input.kind !== "post" || !input.person_id) return;
    if (!person || person.id.toLowerCase() !== input.person_id)
      throw new Error("Pessoa não encontrada na marca desta organização.");
    if (!isoInstant.test(person.consentAt ?? "") || Number.isNaN(Date.parse(person.consentAt)))
      throw new Error("Autorização de uso de imagem não registrada para esta pessoa.");
    if (
      !person.name.trim() ||
      person.name.length > 100 ||
      !person.photos.length ||
      person.photos.length > maxPersonPhotos ||
      !person.photos.every(validImage)
    )
      throw new Error("Fotos da pessoa inválidas: envie de 1 a 3 PNG/JPG de até 5 MB.");
  }
  async function generate(
    tenantId: string,
    raw: unknown,
    company?: CompanyContext,
    logo?: Logo,
    person?: BrandPerson,
  ) {
    if (!tenantId.trim()) throw new Error("Organização autenticada obrigatória.");
    const parsed = createSchema.safeParse(raw);
    // A claimed item must never stay "generating"; its id is the only field needed to fail it.
    if (!parsed.success) {
      const id = studioIdOf(raw);
      if (id) await failClaimed(tenantId, id, parsed.error);
      throw parsed.error;
    }
    const input = parsed.data;
    try {
      validateLogo(input, logo);
      validatePerson(input, person);
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
        input.person_id ? person : undefined,
      );
      const asset_path = await deps.assets.save(tenantId, input.id, bytes, {
        format: input.format,
        ...(input.use_logo && logo && company?.logoMode === "stamp" ? { logo } : {}),
      });
      return await deps.repository.complete(tenantId, input.id, {
        caption,
        asset_path,
        status: "ready",
      });
    } catch (error) {
      await failClaimed(tenantId, input.id, error);
      throw error;
    }
  }
  /** Mark a claimed item failed; a storage error here must not hide the original cause. */
  async function failClaimed(tenantId: string, id: string, cause: unknown) {
    try {
      await deps.repository.complete(tenantId, id, {
        status: "failed",
        error: "Pedido interrompido. Confira o histórico antes de gerar novamente.",
      });
    } catch (storage) {
      if (cause instanceof Error && cause.cause === undefined) cause.cause = storage;
    }
  }
  return {
    /** A durable worker may call this only after atomically claiming its job. */
    generateClaimed: generate,
    async create(
      tenantId: string,
      raw: unknown,
      company?: CompanyContext,
      logo?: Logo,
      person?: BrandPerson,
    ) {
      if (!tenantId.trim()) throw new Error("Organização autenticada obrigatória.");
      const input = createSchema.parse(raw);
      validateLogo(input, logo);
      validatePerson(input, person);
      const claimed = await deps.repository.claim(tenantId, input);
      if (!claimed.created) return claimed.item;
      return generate(tenantId, input, company, logo, person);
    },
  };
}
