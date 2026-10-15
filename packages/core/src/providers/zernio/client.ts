import { z } from "zod";

export class SocialError extends Error {
  constructor(
    message: string,
    public status = 502,
    public upstreamStatus?: number,
    public upstreamCode?: "idempotency_conflict",
  ) {
    super(message);
  }
}
export function parseSocialResponse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new SocialError("O provedor retornou uma resposta inválida.");
  return parsed.data;
}
const providerId = z.string().regex(/^[a-f0-9]{24}$/);
/** Validate before assembling credentialed requests, including direct SDK calls. */
export function validateSocialId(value: string): string {
  const parsed = providerId.safeParse(value);
  if (!parsed.success) throw new SocialError("Identificador do provedor inválido.", 400);
  return parsed.data;
}
/** Fixed provider origin. Credentials never follow a redirect to another host. */
export async function socialRequest(
  key: string,
  path: string,
  body?: unknown,
  options: { method?: "POST" | "PATCH" | "DELETE"; requestId?: string } = {},
): Promise<unknown> {
  if (!key.trim()) throw new SocialError("Configure a credencial social no servidor.", 503);
  const pathname = path.split("?", 1)[0];
  if (
    path.length > 4000 ||
    /[\\#\s]/.test(path) ||
    !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(pathname ?? "")
  )
    throw new SocialError("Caminho do provedor inválido.", 400);
  if (options.requestId && !/^[A-Za-z0-9_-]{1,200}$/.test(options.requestId))
    throw new SocialError("Identificador da operação inválido.", 400);
  const method = options.method ?? (body === undefined ? "GET" : "POST");
  // publishNow completes inside POST /posts; other operations keep a short deadline.
  const timeoutMs = method === "POST" && pathname === "posts" ? 120_000 : 15_000;
  let response: Response;
  try {
    response = await fetch(`https://zernio.com/api/v1/${path}`, {
      method,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Authorization: `Bearer ${key.trim()}`,
        "Content-Type": "application/json",
        ...(options.requestId
          ? {
              "x-request-id": options.requestId,
              "Idempotency-Key": options.requestId,
            }
          : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    const timeout = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
    throw new SocialError(
      timeout
        ? "O prazo do provedor terminou. Consulte o resultado antes de tentar novamente."
        : "Não foi possível confirmar a resposta do provedor. Consulte o resultado antes de tentar novamente.",
      timeout ? 504 : 502,
    );
  }
  if (!response.ok) {
    if (response.status === 409) {
      // Read only a recognized machine code. Never expose provider error text or payloads.
      const failure = await response.json().catch(() => undefined);
      const parsed = z.object({ code: z.literal("idempotency_conflict") }).safeParse(failure);
      if (parsed.success)
        throw new SocialError(
          "A publicação ainda está em processamento. Atualize o resultado antes de tentar novamente.",
          409,
          409,
          "idempotency_conflict",
        );
      throw new SocialError(
        "O provedor identificou um conflito. Confira a conta e o resultado antes de tentar novamente.",
        409,
        409,
      );
    }
    throw new SocialError(
      response.status === 401
        ? "A chave da Zernio é inválida ou expirou. Confira a credencial configurada no servidor."
        : response.status === 403
          ? "A Zernio recusou esta operação. Confira as permissões da chave e os recursos do plano."
          : `O provedor não concluiu a operação (HTTP ${response.status}).`,
      [401, 403, 429].includes(response.status) ? response.status : 502,
      response.status,
    );
  }
  if (response.status === 204) return undefined;
  try {
    return await response.json();
  } catch (error) {
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name))
      throw new SocialError(
        "O prazo do provedor terminou. Consulte o resultado antes de tentar novamente.",
        504,
      );
    throw new SocialError("O provedor retornou uma resposta inválida.");
  }
}
const accountSchema = z.object({
  _id: z.string(),
  platform: z.string(),
  username: z.string().nullish(),
  displayName: z.string().nullish(),
  profilePicture: z.string().nullish(),
  isActive: z.boolean(),
  profileId: z.union([z.string(), z.object({ _id: z.string(), name: z.string().optional() })]),
});
export type SocialAccount = z.infer<typeof accountSchema>;
export async function listSocialAccounts(key: string, profileId: string): Promise<SocialAccount[]> {
  validateSocialId(profileId);
  const parsed = z
    .object({ accounts: z.array(accountSchema) })
    .safeParse(await socialRequest(key, `accounts?profileId=${encodeURIComponent(profileId)}`));
  if (!parsed.success) throw new SocialError("O provedor retornou uma lista de contas inválida.");
  return parsed.data.accounts.filter(
    (a) => (typeof a.profileId === "string" ? a.profileId : a.profileId._id) === profileId,
  );
}
