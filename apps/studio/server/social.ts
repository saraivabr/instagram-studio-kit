import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import {
  socialRequest,
  parseSocialResponse,
  instagramContext,
  requireInstagramAccount,
  publicationInput,
  publishInstagram,
  readInstagramPublication,
  findInstagramPublication,
  instagramInsights,
  instagramAutomations,
  instagramPosts,
  mutateAutomation,
  automationLogSchema,
  SocialError,
  validateSocialId,
} from "@saraivabr/instagram-studio-kit";
import type { RequestContext } from "./runtime";
import { repository } from "./adapters/local/repository";
import { image } from "./adapters/local/assets";
import {
  savedProfile,
  saveProfile,
  publications,
  publication,
  reservePublication,
  updatePublication,
  type StoredPublication,
} from "./adapters/local/social-store";
import { HttpError } from "./errors";

const unavailable =
  "Configure ZERNIO_API_KEY no servidor e reinicie para conectar uma conta profissional do Instagram. A geração de artes continua disponível.";
export function socialConfiguration() {
  return {
    configured: Boolean(process.env.ZERNIO_API_KEY?.trim()),
    message: process.env.ZERNIO_API_KEY?.trim()
      ? "Conecte uma conta profissional (Empresa ou Criador de conteúdo) para publicar."
      : unavailable,
  };
}
const idSchema = z.string().regex(/^[a-f0-9]{24}$/);
const profileSchema = z.object({ _id: idSchema, externalId: z.string().nullish() });
const pendingProfiles = new Map<string, Promise<string>>();
function credentials() {
  const key = process.env.ZERNIO_API_KEY?.trim();
  if (!key) throw new HttpError(503, "social_unconfigured", unavailable);
  const explicit = process.env.ZERNIO_PROFILE_ID?.trim();
  if (explicit && !idSchema.safeParse(explicit).success)
    throw new HttpError(503, "social_configuration", "Confira ZERNIO_PROFILE_ID no servidor.");
  const scope = createHash("sha256")
    .update(JSON.stringify([key, explicit ?? ""]))
    .digest("hex");
  return { key, explicit, scope };
}
async function resolveProfile(context: RequestContext, config: ReturnType<typeof credentials>) {
  const cached = config.explicit || savedProfile(context.tenantId, config.scope);
  if (cached) {
    try {
      const result = parseSocialResponse(
        z.object({ profile: profileSchema }),
        await socialRequest(config.key, `profiles/${cached}`),
      );
      if (
        result.profile._id !== cached ||
        ((!config.explicit || context.tenantId !== "local") &&
          result.profile.externalId !== context.tenantId)
      )
        throw new SocialError("O perfil social não pertence a esta organização.", 403);
      return cached;
    } catch (error) {
      if (!(error instanceof SocialError) || error.upstreamStatus !== 404) throw error;
    }
  }
  const lookup = async () => {
    const found = parseSocialResponse(
      z.object({ profiles: z.array(profileSchema) }),
      await socialRequest(
        config.key,
        `profiles?externalId=${encodeURIComponent(context.tenantId)}`,
      ),
    );
    return found.profiles.find((p) => p.externalId === context.tenantId)?._id;
  };
  let profile = await lookup();
  if (!profile) {
    try {
      const created = parseSocialResponse(
        z.object({ profile: profileSchema }),
        await socialRequest(config.key, "profiles", {
          name: context.brand.name.slice(0, 100),
          externalId: context.tenantId,
        }),
      );
      if (created.profile.externalId !== context.tenantId)
        throw new SocialError("Não foi possível confirmar o perfil desta organização.");
      profile = created.profile._id;
    } catch (error) {
      if (!(error instanceof SocialError) || error.upstreamStatus !== 409) throw error;
      profile = await lookup();
      if (!profile)
        throw new SocialError(
          "O perfil social ainda está sendo preparado. Atualize a conexão.",
          409,
        );
    }
  }
  saveProfile(context.tenantId, config.scope, profile);
  return profile;
}
async function socialContext(context: RequestContext) {
  const config = credentials();
  const lock = `${context.tenantId}:${config.scope}`;
  let pending = pendingProfiles.get(lock);
  if (!pending) {
    pending = resolveProfile(context, config);
    pendingProfiles.set(lock, pending);
  }
  let profileId: string;
  try {
    profileId = await pending;
  } finally {
    if (pendingProfiles.get(lock) === pending) pendingProfiles.delete(lock);
  }
  return { ...(await instagramContext({ key: config.key, profileId })), scope: config.scope };
}
const write = (context: RequestContext) => {
  if (!["admin", "owner", "editor"].includes(context.role))
    throw new HttpError(
      403,
      "write_forbidden",
      "Você não tem permissão para alterar esta conexão ou publicar.",
    );
};
const accounts = (context: Awaited<ReturnType<typeof socialContext>>) =>
  context.accounts.map((a) => ({
    id: a._id,
    username: a.username || a.displayName || "Instagram",
    avatar_url: publicImage(a.profilePicture),
    active: a.isActive,
  }));
function publicImage(value?: string | null) {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}
export async function connections(context: RequestContext) {
  if (!socialConfiguration().configured)
    return { ...socialConfiguration(), accounts: [], can_edit: false };
  return {
    ...socialConfiguration(),
    accounts: accounts(await socialContext(context)),
    can_edit: ["admin", "owner", "editor"].includes(context.role),
  };
}
const connectionCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("connect"), account_id: idSchema.optional() }).strict(),
  z
    .object({ action: z.literal("disconnect"), account_id: idSchema, confirmed: z.literal(true) })
    .strict(),
]);
export async function changeConnection(context: RequestContext, body: unknown, origin: string) {
  write(context);
  credentials();
  const command = connectionCommand.parse(body);
  const social = await socialContext(context);
  if (command.account_id && !social.accounts.some((a) => a._id === command.account_id))
    throw new HttpError(404, "account_not_found", "Conta não encontrada nesta organização.");
  if (command.action === "disconnect") {
    await socialRequest(social.key, `accounts/${command.account_id}`, undefined, {
      method: "DELETE",
    });
    return { disconnected: true };
  }
  const query = new URLSearchParams({
    profileId: social.profileId,
    redirect_url: new URL("/app/connections", origin).toString(),
  });
  if (command.account_id) query.set("reconnectAccountId", command.account_id);
  const result = parseSocialResponse(
    z.object({ authUrl: z.string().url() }),
    await socialRequest(social.key, `connect/instagram?${query}`),
  );
  const url = new URL(result.authUrl);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !/(^|\.)(zernio\.com|instagram\.com|facebook\.com)$/.test(url.hostname) ||
    result.authUrl.includes(social.key)
  )
    throw new SocialError("O provedor retornou um endereço de conexão inválido.");
  return { auth_url: url.toString() };
}
function visible(entry: StoredPublication) {
  const { scope: _scope, profile_id: _profile, owner_pid: _owner, ...result } = entry;
  return result;
}
// PID liveness is deliberately conservative: another process must not release a live upload.
function preparationStopped(entry: StoredPublication) {
  const owner = entry.owner_pid;
  if (!Number.isInteger(owner) || !owner || owner <= 0) return false;
  if (owner === process.pid) return true; // Caller excluded this process's active dispatches.
  try {
    process.kill(owner, 0);
    return false;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "ESRCH";
  }
}
// Keep active operations across development module reloads.
const processState = globalThis as typeof globalThis & { studioSocialDispatching?: Set<string> };
const dispatching = (processState.studioSocialDispatching ??= new Set<string>());
export async function publicationState(context: RequestContext) {
  if (!socialConfiguration().configured)
    return {
      accounts: [],
      publications: publications(context.tenantId).map(visible),
      can_publish: false,
      message: unavailable,
    };
  const social = await socialContext(context);
  const results = [];
  for (const snapshot of publications(context.tenantId)) {
    const entry = publication(context.tenantId, snapshot.id) ?? snapshot;
    if (
      !["preparing", "sending", "pending", "uncertain"].includes(entry.status) ||
      dispatching.has(`${context.tenantId}:${entry.id}`)
    ) {
      results.push(visible(entry));
      continue;
    }
    if (entry.scope !== social.scope || entry.profile_id !== social.profileId) {
      results.push({
        ...visible(entry),
        error:
          "Este envio pertence à conexão anterior. Confira a publicação na conta original antes de fazer outro envio.",
      });
      continue;
    }
    if (entry.status === "preparing") {
      if (!preparationStopped(entry)) {
        results.push({
          ...visible(entry),
          error: "Preparação ainda em andamento ou aguardando conferência. Não repita este envio.",
        });
        continue;
      }
      entry.status = "failed";
      entry.error =
        "Preparação interrompida antes do envio ao Instagram. Revise antes de criar uma nova tentativa.";
      updatePublication(context.tenantId, entry, "preparing");
      results.push(visible(publication(context.tenantId, entry.id) ?? entry));
      continue;
    }
    const expectedStatus = entry.status;
    try {
      if (!social.accounts.some((a) => a._id === entry.account_id))
        throw new SocialError("Reconecte a conta original para conferir este envio.");
      const found = entry.provider_post_id
        ? await readInstagramPublication(social.key, entry.provider_post_id, entry.account_id)
        : await findInstagramPublication(social.key, social.profileId, entry.id, entry.account_id);
      if (found) Object.assign(entry, found);
      else {
        entry.status = "uncertain";
        entry.error = "Envio ainda não confirmado. Atualize o resultado; não repita a publicação.";
      }
      updatePublication(context.tenantId, entry, expectedStatus);
    } catch {
      entry.error =
        "Não foi possível conferir este envio. Atualize o resultado antes de publicar novamente.";
    }
    const current = publication(context.tenantId, entry.id);
    results.push(visible(current && current.status !== expectedStatus ? current : entry));
  }
  return {
    accounts: accounts(social),
    publications: results,
    can_publish:
      ["admin", "owner", "editor"].includes(context.role) &&
      social.accounts.some((a) => a.isActive),
  };
}
function storageUrl(raw: string, kind: "upload" | "public") {
  const url = new URL(raw);
  const allowed =
    kind === "public"
      ? url.hostname === "media.zernio.com"
      : /(^|\.)(r2\.cloudflarestorage\.com|s3\.amazonaws\.com)$/.test(url.hostname);
  if (url.protocol !== "https:" || url.username || url.password || !allowed || url.port)
    throw new SocialError("O provedor retornou um endereço de mídia inválido.");
  return url.toString();
}
export async function publish(context: RequestContext, body: unknown) {
  write(context);
  credentials();
  const input = publicationInput.parse(body);
  if (publication(context.tenantId, input.id))
    throw new HttpError(
      409,
      "publication_exists",
      "Este envio já existe. Atualize o resultado; não repita a publicação.",
    );
  const social = await socialContext(context);
  requireInstagramAccount(social, input.account_id);
  const items = await Promise.all(input.item_ids.map((id) => repository.get(context.tenantId, id)));
  for (const item of items)
    if (
      !item ||
      item.kind !== "post" ||
      item.status !== "ready" ||
      !item.asset_path ||
      item.input.kind !== "post"
    )
      throw new HttpError(
        422,
        "images_not_ready",
        "Todas as imagens devem estar prontas e pertencer à sua organização.",
      );
  if (
    items.some(
      (item) =>
        item!.input.kind === "post" &&
        (input.format === "story"
          ? item!.input.format !== "story"
          : item!.input.format === "story"),
    )
  )
    throw new HttpError(
      422,
      "publication_format",
      "Use uma imagem Story para Stories e imagens de feed para posts e carrosséis.",
    );
  let entry: StoredPublication = {
    ...input,
    scope: social.scope,
    profile_id: social.profileId,
    owner_pid: process.pid,
    status: "preparing",
    provider_post_id: null,
    permalink: null,
    error: null,
    created_at: new Date().toISOString(),
  };
  reservePublication(context.tenantId, entry);
  const lock = `${context.tenantId}:${input.id}`;
  dispatching.add(lock);
  let sent = false;
  try {
    const urls: string[] = [];
    const first = items[0]!;
    const height =
      input.format === "story"
        ? 1920
        : first.input.kind === "post" && first.input.format === "square"
          ? 1080
          : 1350;
    for (const [index, item] of items.entries()) {
      const bytes = await sharp(await image(context.tenantId, item!.id, false, item!.asset_path))
        .rotate()
        .resize(1080, height, { fit: "contain", background: "#ffffff" })
        .jpeg({ quality: 92 })
        .toBuffer();
      const presign = parseSocialResponse(
        z.object({ uploadUrl: z.string().url(), publicUrl: z.string().url() }),
        await socialRequest(social.key, "media/presign", {
          filename: `${input.id}-${index}.jpg`,
          contentType: "image/jpeg",
          size: bytes.length,
        }),
      );
      let uploaded: Response;
      try {
        uploaded = await fetch(storageUrl(presign.uploadUrl, "upload"), {
          method: "PUT",
          redirect: "error",
          signal: AbortSignal.timeout(60000),
          headers: { "Content-Type": "image/jpeg" },
          body: new Uint8Array(bytes),
        });
      } catch {
        throw new SocialError("Não foi possível enviar a imagem preparada para a Zernio.");
      }
      if (!uploaded.ok)
        throw new SocialError("O armazenamento da Zernio recusou a imagem preparada.");
      urls.push(storageUrl(presign.publicUrl, "public"));
    }
    entry = { ...entry, status: "sending" };
    updatePublication(context.tenantId, entry);
    sent = true;
    const result = await publishInstagram(social.key, input, urls);
    entry = { ...entry, ...result };
    updatePublication(context.tenantId, entry);
    return visible(entry);
  } catch (error) {
    const definitive =
      error instanceof SocialError &&
      error.upstreamStatus &&
      [400, 401, 403, 404, 422, 429].includes(error.upstreamStatus);
    entry = {
      ...entry,
      status: sent && !definitive ? "uncertain" : "failed",
      error:
        sent && !definitive
          ? "Envio aguardando confirmação. Atualize o resultado antes de tentar novamente."
          : error instanceof SocialError
            ? error.message
            : "Não foi possível preparar a publicação.",
    };
    updatePublication(context.tenantId, entry);
    return visible(entry);
  } finally {
    dispatching.delete(lock);
  }
}
export async function insights(context: RequestContext, account?: string) {
  if (!socialConfiguration().configured)
    return { connected: false, accounts: [], message: unavailable };
  const social = await socialContext(context);
  return instagramInsights(social, account);
}
export async function growth(context: RequestContext, query: URLSearchParams) {
  if (!socialConfiguration().configured)
    return { automations: [], accounts: [], can_edit: false, message: unavailable };
  const social = await socialContext(context);
  const logs = query.get("logs");
  if (logs) {
    validateSocialId(logs);
    const own = await instagramAutomations(social);
    if (!own.some((a) => a.id === logs))
      throw new HttpError(
        404,
        "automation_not_found",
        "Automação não encontrada nesta organização.",
      );
    return parseSocialResponse(
      z.object({ logs: z.array(automationLogSchema) }),
      await socialRequest(social.key, `comment-automations/${logs}/logs`),
    );
  }
  const account = query.get("account_id");
  if (account) {
    requireInstagramAccount(social, account);
    return { posts: await instagramPosts(social.key, account) };
  }
  let skipped = 0;
  const automations = await instagramAutomations(social, {
    onSkipped: (count) => (skipped = count),
  });
  return {
    automations,
    accounts: accounts(social),
    can_edit: ["admin", "owner", "editor"].includes(context.role),
    ...(skipped
      ? {
          message: `${skipped === 1 ? "1 regra da Zernio não pôde ser lida e não aparece" : `${skipped} regras da Zernio não puderam ser lidas e não aparecem`} aqui. Confira no painel da Zernio.`,
        }
      : {}),
  };
}
export async function changeGrowth(context: RequestContext, body: unknown) {
  write(context);
  credentials();
  const input = z.record(z.string(), z.unknown()).parse(body);
  if (input.confirmed !== true)
    throw new HttpError(
      400,
      "confirmation_required",
      "Confirme a alteração: esta automação pode enviar mensagens reais no Direct.",
    );
  delete input.confirmed;
  return mutateAutomation(await socialContext(context), input);
}
