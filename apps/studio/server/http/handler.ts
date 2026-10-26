import { randomUUID } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createSchema,
  editSchema,
  studioId,
  carouselTemplates,
  maxPersonPhotos,
  StudioError,
  SocialError,
} from "@saraivabr/instagram-studio-kit";
import {
  list,
  getItem,
  editItem,
  image,
  requestContext,
  queueInputs,
  retryItem,
  configuration,
  repository,
  startWorker,
} from "@/server/runtime";
import { HttpError } from "../errors";
import { logFailure } from "../diagnostics.mjs";
import { companyContext } from "@/lib/instagram/brand";
import {
  saveBrand,
  replaceBrandLogo,
  logoPathsInUse,
  storedBrand,
  savePerson,
  storedPerson,
  deletePerson,
} from "@/server/adapters/local/repository";
import {
  saveBrandLogo,
  pruneBrandLogos,
  withBrandLogoLock,
  readBrandLogo,
  savePersonPhoto,
  readPersonPhoto,
  deletePersonPhotos,
} from "@/server/adapters/local/assets";
import {
  socialConfiguration,
  connections,
  changeConnection,
  publicationState,
  publish,
  insights,
  growth,
  changeGrowth,
} from "../social";
const listSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(24),
    cursor: z.string().max(1000).optional(),
    kind: z.enum(["post", "reference", "research"]).optional(),
    status: z.enum(["generating", "ready", "failed"]).optional(),
    carousel_id: studioId.optional(),
  })
  .strict();
const carouselSchema = z
  .object({
    id: studioId,
    item_ids: z
      .array(studioId)
      .length(8)
      .refine((ids) => new Set(ids).size === 8, "IDs de slides devem ser únicos."),
    template: z.enum(Object.keys(carouselTemplates) as [keyof typeof carouselTemplates]),
    brief: z.string().trim().min(10).max(3000),
    niche: z.string().trim().min(2).max(2000),
    use_logo: z.boolean().default(true),
    person_id: studioId.optional(),
    format: z.literal("feed").default("feed"),
  })
  .strict();
const brandSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().min(2).max(2000),
    accent: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "Use uma cor no formato #RRGGBB.")
      .transform((value) => value.toLowerCase()),
    logo_mode: z.enum(["ai", "stamp"]).optional(),
  })
  .strict();
const logoLimit = 5_000_000;
const photoLimit = 5_000_000;
const personNameSchema = z.string().trim().min(1).max(100);
/** Read a multipart upload under its own limit (the JSON limit is 20 KB). */
async function readMultipart(
  req: NextRequest,
  limit: number,
  tooLarge: { code: string; message: string },
  multipartMessage: string,
) {
  const type = req.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data;/i.test(type))
    throw new HttpError(400, "multipart_required", multipartMessage);
  const declared = Number(req.headers.get("content-length") ?? 0);
  const cap = limit + 100_000;
  if (declared > cap) throw new HttpError(413, tooLarge.code, tooLarge.message);
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, "body_required", "Envie um arquivo.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > cap) {
      await reader.cancel();
      throw new HttpError(413, tooLarge.code, tooLarge.message);
    }
    chunks.push(value);
  }
  try {
    return await new Response(Buffer.concat(chunks), {
      headers: { "content-type": type },
    }).formData();
  } catch {
    throw new HttpError(400, "invalid_upload", "Upload inválido.");
  }
}
async function readLogoUpload(req: NextRequest) {
  const form = await readMultipart(
    req,
    logoLimit,
    { code: "logo_too_large", message: "O logo deve ter até 5 MB." },
    "Envie o logo como arquivo (multipart).",
  );
  const file = form.get("logo") ?? form.get("file");
  if (!(file instanceof File) || !file.size)
    throw new HttpError(400, "logo_required", "Escolha um arquivo de logo.");
  if (file.size > logoLimit)
    throw new HttpError(413, "logo_too_large", "O logo deve ter até 5 MB.");
  return new Uint8Array(await file.arrayBuffer());
}
async function readJson(req: NextRequest) {
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, "body_required", "Body JSON obrigatório.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 20000) {
      await reader.cancel();
      throw new HttpError(413, "body_too_large", "Body excede 20 KB.");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "invalid_json", "JSON inválido.");
  }
}
export async function handleStudioRequest(req: NextRequest) {
  const requestId = randomUUID();
  const respond = (data: unknown, status = 200, headers?: Record<string, string>) =>
    NextResponse.json(
      { data },
      { status, headers: { "Cache-Control": "no-store", "X-Request-ID": requestId, ...headers } },
    );
  const allow = (...methods: string[]) => {
    if (!methods.includes(req.method))
      throw new HttpError(
        405,
        `method_not_allowed:${methods.join(", ")}`,
        "Método não permitido nesta rota.",
      );
  };
  try {
    const header = req.headers.get("host");
    let requestOrigin: URL;
    try {
      if (!header || /[\s/\\@?#]/.test(header)) throw new Error("host");
      requestOrigin = new URL(`${req.nextUrl.protocol}//${header}`);
    } catch {
      throw new HttpError(400, "invalid_host", "Host inválido.");
    }
    if (!["127.0.0.1", "localhost", "[::1]"].includes(requestOrigin.hostname))
      throw new HttpError(
        403,
        "local_only",
        "Exemplo local: integre autenticação antes de hospedar.",
      );
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.get("origin") !== requestOrigin.origin
    )
      throw new HttpError(403, "invalid_origin", "Origem inválida.");
    const context = await requestContext(req);
    const tenant = context.tenantId;
    const ensureWrite = () => {
      if (!["admin", "owner", "editor"].includes(context.role))
        throw new HttpError(403, "write_forbidden", "Você não tem permissão para editar conteúdo.");
    };
    const path = req.nextUrl.pathname;
    const asset = /^\/api\/assets\/([^/]+)$/.exec(path);
    if (asset) {
      allow("GET");
      const id = studioId.parse(asset[1]);
      const item = await getItem(id, tenant, context.role);
      if (!item?.asset_path) throw new HttpError(404, "asset_not_found", "Arquivo não encontrado.");
      const thumbnail = req.nextUrl.searchParams.get("thumbnail") === "1";
      const bytes = await image(tenant, id, thumbnail, item.asset_path);
      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          "Content-Type": thumbnail ? "image/webp" : "image/png",
          "Cache-Control": "private, no-store",
          "X-Request-ID": requestId,
        },
      });
    }
    const people = /^\/api\/v1\/brand\/people(?:\/([^/]+)(?:\/photos\/([^/]+))?)?$/.exec(path);
    if (people) {
      const [, rawId, photo] = people;
      const peopleView = async () => ({
        people: (await companyContext(tenant)).people,
        can_edit: ["admin", "owner", "editor"].includes(context.role),
      });
      if (!rawId) {
        allow("GET", "POST");
        if (req.method === "GET") return respond(await peopleView());
        ensureWrite();
        const form = await readMultipart(
          req,
          photoLimit * maxPersonPhotos,
          { code: "photos_too_large", message: "Cada foto deve ter até 5 MB." },
          "Envie as fotos como arquivos (multipart).",
        );
        if (!["true", "on", "1"].includes(String(form.get("consent") ?? "")))
          throw new HttpError(
            400,
            "consent_required",
            "Confirme que você tem autorização desta pessoa para usar a imagem dela.",
          );
        const name = personNameSchema.safeParse(form.get("name"));
        if (!name.success)
          throw new HttpError(400, "invalid_name", "Informe o nome da pessoa, até 100 caracteres.");
        const files = form
          .getAll("photos")
          .filter((file): file is File => file instanceof File && file.size > 0);
        if (!files.length || files.length > maxPersonPhotos)
          throw new HttpError(
            400,
            "photos_required",
            `Envie de 1 a ${maxPersonPhotos} fotos de frente da pessoa.`,
          );
        if (files.some((file) => file.size > photoLimit))
          throw new HttpError(413, "photos_too_large", "Cada foto deve ter até 5 MB.");
        const id = randomUUID();
        const saved: string[] = [];
        try {
          for (const file of files)
            saved.push(await savePersonPhoto(tenant, id, new Uint8Array(await file.arrayBuffer())));
          savePerson(tenant, { id, name: name.data, photos: saved, consent_by: context.userId });
        } catch (error) {
          // Never keep photos of someone who was not registered.
          await deletePersonPhotos(tenant, saved);
          throw error;
        }
        return respond(await peopleView(), 201);
      }
      const id = studioId.parse(rawId);
      if (photo) {
        allow("GET");
        const index = Number(photo);
        const file = Number.isInteger(index) ? storedPerson(tenant, id)?.photos[index - 1] : null;
        if (!file) throw new HttpError(404, "photo_not_found", "Foto não encontrada.");
        return new NextResponse(new Uint8Array(await readPersonPhoto(tenant, file)), {
          headers: {
            "Content-Type": "image/jpeg",
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "X-Request-ID": requestId,
          },
        });
      }
      allow("DELETE");
      ensureWrite();
      const removed = deletePerson(tenant, id);
      if (!removed) throw new HttpError(404, "person_not_found", "Pessoa não encontrada.");
      // Removing a person withdraws consent: the photos go away now, even with jobs queued.
      await deletePersonPhotos(tenant, removed);
      return respond(await peopleView());
    }
    if (path === "/api/v1/brand" || path === "/api/v1/brand/logo") {
      const view = async () => {
        const brand = await companyContext(tenant);
        const stored = storedBrand(tenant);
        return {
          registered: !!stored?.name?.trim(),
          name: brand.name,
          description: stored?.description?.trim() ? brand.description : "",
          accent: brand.accent,
          logo_url: brand.logoUrl,
          logo_mode: brand.logoMode,
          people: brand.people,
          can_edit: [`admin`, `owner`, `editor`].includes(context.role),
        };
      };
      // Runs inside withBrandLogoLock, so the keep set reflects the latest replacement.
      const cleanup = async () =>
        pruneBrandLogos(
          tenant,
          new Set([
            ...logoPathsInUse(tenant),
            ...(storedBrand(tenant)?.logo_path ? [storedBrand(tenant)!.logo_path!] : []),
          ]),
        );
      if (path === "/api/v1/brand") {
        allow("GET", "PUT");
        if (req.method === "GET") return respond(await view());
        ensureWrite();
        const input = brandSchema.parse(await readJson(req));
        saveBrand(tenant, {
          name: input.name,
          description: input.description,
          accent: input.accent,
          logo_mode: input.logo_mode ?? storedBrand(tenant)?.logo_mode ?? "stamp",
        });
        return respond(await view());
      }
      allow("GET", "POST", "DELETE");
      if (req.method === "GET") {
        const logo = storedBrand(tenant)?.logo_path;
        if (!logo) throw new HttpError(404, "logo_not_found", "Logo não encontrado.");
        const file = await readBrandLogo(tenant, logo);
        return new NextResponse(new Uint8Array(file.bytes), {
          headers: {
            "Content-Type": file.type,
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "X-Request-ID": requestId,
          },
        });
      }
      ensureWrite();
      const upload = req.method === "POST" ? await readLogoUpload(req) : null;
      await withBrandLogoLock(tenant, async () => {
        replaceBrandLogo(tenant, upload ? await saveBrandLogo(tenant, upload) : null);
        // Jobs already queued keep their own logo file until they finish.
        await cleanup();
      });
      return respond(await view());
    }
    if (path === "/api/v1/instagram/config") {
      allow("GET");
      const config = configuration();
      const social = socialConfiguration();
      return respond({
        ...config,
        message:
          config.mode === "demo" && social.configured
            ? "Artes de demonstração, sem custos de IA. A Zernio está configurada: publicações e automações podem executar ações reais após sua confirmação."
            : config.message,
        social,
      });
    }
    if (path === "/api/v1/instagram") {
      allow("GET", "POST");
      if (req.method === "GET") {
        startWorker();
        const query = listSchema.parse(Object.fromEntries(req.nextUrl.searchParams));
        return respond({
          ...(await list(tenant, query, context.role)),
          can_create: ["admin", "owner", "editor"].includes(context.role),
        });
      }
      const input = createSchema.parse(await readJson(req));
      return respond(
        (await queueInputs(context, [input]))[0],
        input.kind === "reference" ? 200 : 202,
      );
    }
    if (path === "/api/v1/instagram/carousels") {
      allow("POST");
      const input = carouselSchema.parse(await readJson(req));
      const items = input.item_ids.map((id, index) =>
        createSchema.parse({
          id,
          kind: "post",
          brief: input.brief,
          niche: input.niche,
          use_logo: input.use_logo,
          ...(input.person_id ? { person_id: input.person_id } : {}),
          format: "feed",
          carousel: { id: input.id, template: input.template, slide: index + 1 },
        }),
      );
      return respond({ items: await queueInputs(context, items) }, 202);
    }
    if (path === "/api/v1/instagram/account") {
      allow("GET");
      const state = await connections(context);
      return respond({ account: state.accounts.find((account) => account.active) ?? null });
    }
    if (path === "/api/v1/instagram/connections") {
      allow("GET", "POST");
      if (req.method === "GET") return respond(await connections(context));
      return respond(await changeConnection(context, await readJson(req), requestOrigin.origin));
    }
    if (path === "/api/v1/instagram/insights") {
      allow("GET");
      return respond(
        await insights(context, req.nextUrl.searchParams.get("account_id") ?? undefined),
      );
    }
    if (path === "/api/v1/instagram/publish") {
      allow("GET", "POST");
      if (req.method === "GET") return respond(await publicationState(context));
      return respond(await publish(context, await readJson(req)));
    }
    if (path === "/api/v1/growth/instagram") {
      allow("GET", "POST");
      if (req.method === "GET") return respond(await growth(context, req.nextUrl.searchParams));
      return respond(await changeGrowth(context, await readJson(req)));
    }
    const retry = /^\/api\/v1\/instagram\/([^/]+)\/retry$/.exec(path);
    if (retry) {
      allow("POST");
      return respond(await retryItem(context, studioId.parse(retry[1])), 202);
    }
    const detail = /^\/api\/v1\/instagram\/([^/]+)$/.exec(path);
    if (detail) {
      allow("GET", "PATCH", "DELETE");
      const id = studioId.parse(detail[1]);
      const item = await getItem(id, tenant, context.role);
      if (!item) throw new HttpError(404, "item_not_found", "Item não encontrado.");
      if (req.method === "GET") return respond(item);
      ensureWrite();
      if (req.method === "PATCH")
        return respond(
          await editItem(tenant, id, editSchema.parse(await readJson(req)).caption, context.role),
        );
      return respond(await repository.archive(tenant, id));
    }
    throw new HttpError(404, "route_not_found", "Rota indisponível.");
  } catch (error) {
    const validation = error instanceof z.ZodError;
    const known =
      error instanceof HttpError || error instanceof StudioError || error instanceof SocialError;
    const status = validation ? 400 : known ? error.status : 500;
    const rawCode =
      error instanceof HttpError
        ? error.code
        : validation
          ? "validation_error"
          : known
            ? "provider_error"
            : "internal_error";
    const code = rawCode.split(":")[0]!;
    const message = validation
      ? "Confira os campos enviados."
      : known
        ? error.message
        : "Não foi possível concluir. Consulte o servidor com o ID desta requisição.";
    const details = { event: "studio_request_failed", request_id: requestId, status, code };
    if (status >= 500) logFailure(details, error);
    else console.error(JSON.stringify(details));
    return NextResponse.json(
      {
        error: {
          code,
          message,
          request_id: requestId,
          ...(validation
            ? {
                fields: error.issues.map((issue) => ({
                  path: issue.path.join("."),
                  message: issue.message,
                })),
              }
            : {}),
        },
      },
      {
        status,
        headers: {
          "Cache-Control": "no-store",
          "X-Request-ID": requestId,
          ...(status === 405 ? { Allow: rawCode.split(":")[1]! } : {}),
        },
      },
    );
  }
}
