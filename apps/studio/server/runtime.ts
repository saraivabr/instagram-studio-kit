import "server-only";
import { randomUUID } from "node:crypto";
import {
  createAi,
  createStudio,
  openAiTransport,
  createSchema,
  studioId,
  type StudioItem,
  type StudioInput,
  type StudioListQuery,
  StudioError,
  SocialError,
} from "@saraivabr/instagram-studio-kit";
import {
  repository,
  enqueue,
  claimJob,
  finishJob,
  recoverInterruptedJobs,
} from "./adapters/local/repository";
import { localAssets, loadLogo } from "./adapters/local/assets";
import { mockAiRequest } from "./adapters/demo/ai";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { companyContext } from "@/lib/instagram/brand";
import { HttpError } from "./errors";
import { logFailure, createWorkerBackoff } from "./diagnostics.mjs";
export { image } from "./adapters/local/assets";
export { repository };
function settings() {
  const key = process.env.OPENAI_API_KEY?.trim() || "";
  const image = process.env.OPENAI_IMAGE_MODEL?.trim() || "";
  const text = process.env.OPENAI_TEXT_MODEL?.trim() || "";
  const imageSizes = Object.fromEntries(
    (["feed", "square", "story"] as const).flatMap((format) => {
      const value = process.env[`OPENAI_IMAGE_SIZE_${format.toUpperCase()}`]?.trim();
      return value ? [[format, value]] : [];
    }),
  );
  return { key, image, text, imageSizes };
}
export function configuration() {
  const values = settings();
  if (!values.key && !values.image && !values.text)
    return {
      mode: "demo" as const,
      message:
        "Demonstração local: artes simuladas, sem custos de IA. Pesquisa real e publicação exigem integração.",
      can_research: false,
    };
  try {
    if (!values.key || !values.image || !values.text) throw new Error("incomplete");
    createAi(openAiTransport(values.key), values, { imageSizes: values.imageSizes });
    return {
      mode: "configured" as const,
      message: "IA configurada. Cada nova geração pode consumir créditos do provedor.",
      can_research: true,
    };
  } catch {
    return {
      mode: "incomplete" as const,
      message:
        "Configuração incompleta: confira a chave, os dois modelos e os tamanhos de imagem no servidor.",
      can_research: false,
    };
  }
}
function application() {
  const config = configuration();
  const values = settings();
  if (config.mode === "incomplete")
    throw new HttpError(503, "configuration_incomplete", config.message);
  return createStudio({
    ai: createAi(
      config.mode === "demo" ? mockAiRequest : openAiTransport(values.key),
      { image: values.image || "mock", text: values.text || "mock" },
      { imageSizes: values.imageSizes },
    ),
    repository,
    assets: localAssets,
  });
}
export async function requestContext(request?: Request) {
  const user = await requireAuth(request);
  if (!user?.id) throw new HttpError(401, "authentication_required", "Entre na sua conta.");
  const org = await resolveActiveOrg(user);
  if (!org?.orgId?.trim())
    throw new HttpError(403, "organization_required", "Organização ativa obrigatória.");
  const brand = await companyContext(org.orgId);
  return { tenantId: org.orgId, role: org.role, brand };
}
export type RequestContext = Awaited<ReturnType<typeof requestContext>>;
export function present(item: StudioItem, role = "viewer") {
  const canWrite = ["admin", "owner", "editor"].includes(role);
  return {
    ...item,
    can_edit: canWrite && item.kind === "post" && item.status === "ready",
    can_archive: canWrite && item.status !== "generating",
    can_retry: canWrite && item.status === "failed",
    image_url: item.asset_path ? `/api/assets/${item.id}` : null,
  };
}
export async function list(tenantId: string, query?: StudioListQuery, role = "viewer") {
  const page = await repository.list(tenantId, query);
  return { ...page, items: page.items.map((item) => present(item, role)) };
}
export async function getItem(id: string, tenantId = "local", role = "viewer") {
  const parsed = studioId.safeParse(id);
  if (!parsed.success) return;
  const item = await repository.get(tenantId, parsed.data);
  return item ? present(item, role) : undefined;
}
export async function editItem(tenantId: string, id: string, caption: string, role = "viewer") {
  return present(await repository.updateCaption(tenantId, id, caption), role);
}
export async function queueInputs(
  context: RequestContext,
  inputs: StudioInput[],
  replaceId?: string,
) {
  if (!["admin", "owner", "editor"].includes(context.role))
    throw new HttpError(403, "write_forbidden", "Você não tem permissão para criar conteúdo.");
  const config = configuration();
  if (inputs.some((input) => input.kind !== "reference") && config.mode === "incomplete")
    throw new HttpError(503, "configuration_incomplete", config.message);
  if (inputs.some((input) => input.kind === "research") && !config.can_research)
    throw new HttpError(
      503,
      "research_unavailable",
      "Pesquisa real requer credencial e modelo configurados no servidor.",
    );
  if (inputs.some((input) => input.kind === "post" && input.use_logo))
    await loadLogo(context.tenantId, context.brand.logoPath);
  const items = enqueue(
    context.tenantId,
    inputs,
    { name: context.brand.name, accent: context.brand.accent, logoPath: context.brand.logoPath },
    replaceId,
  );
  startWorker();
  return items.map((item) => present(item, context.role));
}
export async function retryItem(context: RequestContext, id: string) {
  const item = await repository.get(context.tenantId, id);
  if (!item) throw new HttpError(404, "item_not_found", "Item não encontrado.");
  if (item.status !== "failed")
    throw new HttpError(
      409,
      "retry_not_allowed",
      "Somente pedidos interrompidos podem ser tentados novamente.",
    );
  const input = createSchema.parse({ ...item.input, id: randomUUID() });
  return (await queueInputs(context, [input], id))[0]!;
}
const state = globalThis as typeof globalThis & {
  studioWorker?: ReturnType<typeof setInterval>;
  studioWorking?: boolean;
  studioWorkerRecovered?: boolean;
  studioWorkerBackoff?: ReturnType<typeof createWorkerBackoff>;
};
async function runWorker() {
  const backoff = (state.studioWorkerBackoff ??= createWorkerBackoff());
  if (state.studioWorking || !backoff.ready()) return;
  state.studioWorking = true;
  try {
    // globalThis survives dev reloads, so only a new process clears previous running jobs.
    // If storage is unavailable, leave this unset and retry through the normal backoff.
    if (!state.studioWorkerRecovered) {
      recoverInterruptedJobs();
      state.studioWorkerRecovered = true;
    }
    const job = claimJob();
    if (!job) {
      backoff.success();
      return;
    }
    const item = await repository.get(job.tenant, job.item_id);
    if (!item || item.status !== "generating") {
      finishJob(job.id, false);
      backoff.success();
      return;
    }
    try {
      const logo =
        item.input.kind === "post" && item.input.use_logo
          ? await loadLogo(job.tenant, job.context.logoPath)
          : undefined;
      await application().generateClaimed(job.tenant, item.input, job.context, logo);
      finishJob(job.id, true);
    } catch (error) {
      const known =
        error instanceof StudioError || error instanceof SocialError || error instanceof HttpError;
      const message = known ? error.message : "Pedido interrompido.";
      logFailure(
        {
          event: "studio_job_failed",
          job_id: job.id,
          item_id: item.id,
          code: error instanceof HttpError ? error.code : "generation_failed",
          status: known ? error.status : 500,
          ...(error instanceof StudioError && error.upstreamStatus
            ? { upstream_status: error.upstreamStatus }
            : {}),
        },
        error,
      );
      await repository.complete(job.tenant, item.id, {
        status: "failed",
        error: `${message} Confira o histórico do provedor antes de tentar novamente; uma nova geração pode ser cobrada.`,
      });
      finishJob(job.id, false);
    }
    backoff.success();
  } catch (error) {
    const retry = backoff.failure(error);
    if (retry.shouldLog)
      logFailure(
        {
          event: "studio_worker_failed",
          code: "storage_or_worker_error",
          retry_in_ms: retry.retry_in_ms,
          attempt: retry.attempt,
        },
        error,
      );
  } finally {
    state.studioWorking = false;
  }
}
export function startWorker() {
  if (!state.studioWorker) {
    state.studioWorker = setInterval(() => void runWorker(), 1000);
    state.studioWorker.unref();
  }
  void runWorker();
}
