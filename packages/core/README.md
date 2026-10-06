# @saraivabr/instagram-studio-kit

SDK TypeScript para artes, carrosséis, legendas e pesquisa, com adapters Instagram via Zernio. Independente de Next.js e do CRM; licença MIT.

A versão **0.2.0** é distribuída por tarball, sem publicação no registro npm. No repositório, rode `npm ci` e `npm run pack:core`; instale `saraivabr-instagram-studio-kit-0.2.0.tgz` no produto anfitrião. O workspace completo requer Node.js 22.13 ou superior por seu adapter SQLite local.

```ts
import { createStudio } from "@saraivabr/instagram-studio-kit/studio";
import { createAi, openAiTransport } from "@saraivabr/instagram-studio-kit/ai";

const ai = createAi(
  openAiTransport(process.env.OPENAI_API_KEY!),
  {
    image: process.env.OPENAI_IMAGE_MODEL!,
    text: process.env.OPENAI_TEXT_MODEL!,
  },
  // Opcional; use apenas tamanhos aceitos pelo modelo.
  { imageSizes: { feed: "1024x1536" } },
);
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

O anfitrião fornece autenticação, tenant confiável, marca, permissões, armazenamento, orçamento e auditoria. `StudioRepository.claim` deve ser atômico por organização e UUID; falhas não causam reenvio pago automático. `StudioReadRepository` acrescenta leitura paginada, legenda e arquivamento sem exigir mudanças em adapters antigos que implementam apenas criação.

`create` continua aguardando a geração. `generateClaimed` serve para seu worker depois de claim exclusivo e durável; não contém fila. O aplicativo de exemplo inclui fila persistente, cota diária e recuperação em SQLite, separados do SDK.

Tamanhos padrão de geração: vertical/Story `1024x1536`, quadrado `1024x1024`. `createAi` valida modelos/tamanhos configurados antes de chamar o provedor; o anfitrião confirma disponibilidade e crédito. `AssetStore.save` recebe opcionalmente `{ format }` como quarto argumento para aplicar recorte final 4:5, 1:1 ou 9:16. O SDK não depende de Sharp e não recorta sozinho.

Os adapters sociais são operações de backend e exigem autorização antes de publicar ou ativar mensagens. Permalink inválido não invalida recibo `published`; resultado incerto deve ser reconciliado antes de reenviar. Funções exportadas validam IDs e caminhos, e erros de transports são sanitizados.

Imports: raiz para a API completa, `/studio` para casos de uso, `/schemas` para contratos, `/ai` para geração e `/social` para Zernio. Nunca use transports com credenciais no navegador.

[Guia de integração](https://github.com/saraivabr/instagram-studio-kit/blob/main/docs/integration.md) · [Aplicativo com interface original](https://github.com/saraivabr/instagram-studio-kit/tree/main/apps/studio)
