# @saraivabr/instagram-studio-kit

SDK TypeScript para criação de artes, carrosséis, legendas e pesquisa; adapters de Instagram via Zernio. Node.js 22+ e licença MIT. Independente de Next.js e do CRM.

```ts
import { createStudio } from "@saraivabr/instagram-studio-kit/studio";
import { createAi, openAiTransport } from "@saraivabr/instagram-studio-kit/ai";

const ai = createAi(openAiTransport(process.env.OPENAI_API_KEY!), {
  image: process.env.OPENAI_IMAGE_MODEL!,
  text: process.env.OPENAI_TEXT_MODEL!,
});
const studio = createStudio({
  ai,
  repository: seuRepositorio,
  assets: seuStorage,
});
const item = await studio.create(
  sessao.organizationId,
  {
    id: crypto.randomUUID(),
    kind: "post",
    format: "feed",
    niche: "Consultoria",
    brief: "Como organizar o atendimento aos clientes.",
  },
  { name: "Sua empresa" },
);
```

O anfitrião fornece `StudioRepository` e `AssetStore`, autenticação, organização confiável, limites, orçamento e auditoria. `claim` deve ser atômico por organização e UUID; falhas preservam a intenção e não causam reenvio automático. Os adapters sociais são operações de backend e exigem autorização antes de publicar ou ativar mensagens.

Imports: raiz para a API completa, `/studio` para o caso de uso, `/schemas` para contratos, `/ai` para geração e `/social` para Zernio. Nunca importe providers de IA/social no navegador com credenciais.

[Guia de integração](https://github.com/saraivabr/instagram-studio-kit/blob/main/docs/integration.md) · [Aplicativo com interface original](https://github.com/saraivabr/instagram-studio-kit/tree/main/apps/studio)
