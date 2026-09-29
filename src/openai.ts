import type { AiRequest } from "./ai.js";
import { StudioError } from "./ai.js";
/** Server-only. No retries: an ambiguous failure may have incurred provider cost. */
export function openAiTransport(
  apiKey: string,
  fetcher: typeof fetch = fetch,
): AiRequest {
  if (!apiKey.trim())
    throw new StudioError("Configure a credencial no servidor.", 503);
  return async (path, body, multipart) => {
    if (!["responses", "images/generations", "images/edits"].includes(path))
      throw new StudioError("Operação de IA inválida.", 400);
    const response = await fetcher(`https://api.openai.com/v1/${path}`, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(240_000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(multipart ? {} : { "Content-Type": "application/json" }),
      },
      body: multipart ?? JSON.stringify(body),
    });
    if (!response.ok)
      throw new StudioError(
        `A IA não concluiu o pedido (HTTP ${response.status}).`,
        response.status === 429 ? 429 : 502,
      );
    return response.json();
  };
}
