import type { AiRequest } from "./ai.js";
import { StudioError } from "./ai.js";
/** Server-only. No retries: an ambiguous failure may have incurred provider cost. */
export function openAiTransport(apiKey: string, fetcher: typeof fetch = fetch): AiRequest {
  if (!apiKey.trim()) throw new StudioError("Configure a credencial no servidor.", 503);
  return async (path, body, multipart) => {
    if (!["responses", "images/generations", "images/edits"].includes(path))
      throw new StudioError("Operação de IA inválida.", 400);
    let response: Response;
    try {
      response = await fetcher(`https://api.openai.com/v1/${path}`, {
        method: "POST",
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(240_000),
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          ...(multipart ? {} : { "Content-Type": "application/json" }),
        },
        body: multipart ?? JSON.stringify(body),
      });
    } catch (error) {
      const timeout = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
      throw new StudioError(
        timeout
          ? "O prazo de resposta da IA terminou. Confira o pedido antes de gerar novamente."
          : "Não foi possível confirmar a resposta da IA. Confira o pedido antes de gerar novamente.",
        timeout ? 504 : 502,
      );
    }
    if (!response.ok) {
      const messages: Record<number, string> = {
        400: "A IA recusou os parâmetros do pedido. Confira o modelo e os tamanhos configurados.",
        401: "A IA recusou a credencial. Confira a chave configurada no servidor.",
        403: "A IA recusou o acesso. Confira as permissões da organização no provedor.",
        404: "O modelo ou recurso de IA não foi encontrado. Confira a configuração no servidor.",
        422: "A IA não aceitou os dados do pedido. Confira o formato e a configuração.",
        429: "O limite de uso da IA foi atingido. Confira a cota e o orçamento no provedor.",
      };
      throw new StudioError(
        messages[response.status] ??
          "A IA não concluiu o pedido. Tente consultar o resultado antes de gerar novamente.",
        messages[response.status] ? response.status : 502,
        response.status,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new StudioError("A IA retornou uma resposta inválida. O pedido foi preservado.");
    }
  };
}
