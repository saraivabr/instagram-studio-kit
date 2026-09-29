# Instagram Studio Kit

Criação de artes e carrosséis com IA, pesquisa de referências e integração de Instagram para incorporar ao seu próprio produto. Extraído do módulo de Instagram do [escreve.ai / DeskcommCRM](https://github.com/saraivabr/DeskcommCRM), com licença MIT e sem dependência do CRM no núcleo.

## Experimente

Node.js 22 ou superior:

```bash
git clone https://github.com/saraivabr/instagram-studio-kit.git
cd instagram-studio-kit
npm ci
npm test
npm run app:install
npm run demo
```

Abra http://127.0.0.1:4318/app/instagram. A demonstração é **simulada**, sem chaves, gastos, publicações ou mensagens reais. Ela exercita criação, carrossel de oito slides e repetição por UUID. O aplicativo em `apps/studio/` usa as mesmas telas, navegação, animações, componentes, tokens e fontes do módulo original. O exemplo mínimo do SDK continua disponível com `npm run demo:sdk`.

![Interface original do Instagram Studio](docs/studio-preview.png)

## O que está incluído

| Parte              | Entrega                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| Artes              | Geração PNG, legenda, formatos feed/quadrado/story, identidade e logo opcional                              |
| Carrosséis         | Roteiro original de oito slides, ordem e legenda apenas no primeiro                                         |
| Pesquisa           | Busca com fontes HTTPS; falha explícita quando faltam citações                                              |
| Fluxo de criação   | Persistência antes de gerar; UUID por organização; histórico de falhas                                      |
| Instagram          | Contas por perfil, publicação, consulta e reconciliação de recibos                                          |
| Automação          | Criar, editar e ativar/pausar regras de comentários e Direct via Zernio                                     |
| Métricas           | Consulta de resultados; métricas ausentes permanecem indisponíveis                                          |
| Interface original | Aplicativo Next.js executável com visão geral, criação, biblioteca, revisão, inspirações, insights e growth |

O pacote `src/` é independente. `apps/studio/` entrega a interface original funcionando com backend local e dados persistidos em `.studio-data/`. A árvore `reference/` mantém a implementação anterior para consulta durante integração. Autenticação, multi-tenancy de produção, cobrança e conexão social devem ser fornecidas pelo produto anfitrião; o exemplo roda apenas em loopback.

## Use no seu backend

Compile com `npm run build`. Em outro projeto, instale diretamente do GitHub ou gere um pacote local:

```bash
# Dentro deste repositório
npm run build
npm pack
# No seu aplicativo, instale o arquivo .tgz gerado
npm install /caminho/saraivabr-instagram-studio-kit-0.1.0.tgz
```

```ts
import {
  createAi,
  openAiTransport,
  createStudio,
  type StudioRepository,
  type AssetStore,
} from "@saraivabr/instagram-studio-kit";

// O seu produto fornece banco e armazenamento privados.
const repository: StudioRepository = seuRepositorio;
const assets: AssetStore = seuArmazenamento;
const ai = createAi(openAiTransport(process.env.OPENAI_API_KEY!), {
  image: process.env.OPENAI_IMAGE_MODEL!,
  text: process.env.OPENAI_TEXT_MODEL!,
});
const studio = createStudio({ ai, repository, assets });

// Sua rota autentica, autoriza, limita e resolve empresa/logo antes de chamar.
const item = await studio.create(
  sessao.organizationId,
  {
    id: crypto.randomUUID(),
    kind: "post",
    format: "feed",
    niche: "Consultoria de negócios",
    brief: "Como organizar melhor o atendimento.",
  },
  { name: "Sua empresa", accent: "#235c49" },
);
```

Defina modelos disponíveis na sua conta que suportem os endpoints e tamanhos solicitados. Os identificadores específicos usados no CRM não são impostos aos integradores. Você também pode fornecer seu próprio `AiRequest`, incluindo reservas de orçamento, medição de consumo e outro provedor compatível.

### Conecte Instagram

```ts
import {
  instagramContext,
  requireInstagramAccount,
  instagramInsights,
} from "@saraivabr/instagram-studio-kit";

// Carregue chave e perfil a partir da organização autenticada, no servidor.
const context = await instagramContext({
  key: chaveDaOrganizacao,
  profileId: perfilDaOrganizacao,
});
requireInstagramAccount(context, contaSelecionada);
const metrics = await instagramInsights(context, contaSelecionada);
```

Os adapters sociais usam Zernio; não implementam OAuth direto da Meta. O operador provisiona o perfil e a conexão conforme seu provedor. Nunca envie as credenciais ou o objeto `context` ao navegador.

Publicação e automações são efeitos externos: use uma ação explícita de usuário autorizado. Consulte [integração](docs/integration.md) para persistência, reconciliação, autorização e adaptação das telas.

## Verificação

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run app:build
# Com o aplicativo rodando em outra janela:
npm run test:app
```

Testes usam doubles locais: verificam isolamento, idempotência, falhas, validação, carrosséis, fontes e recibos. Não comprovam geração paga, OAuth, publicação, entrega de Direct ou métricas em uma conta real.

## Licença e origem

MIT. Preserve `LICENSE` e `NOTICE` ao redistribuir. Não inclui dados de clientes, credenciais, assets privados, histórico Git do CRM ou subsistemas de CRM/billing/WhatsApp. Não está publicado no npm; o repositório e o `.tgz` são os meios de distribuição desta versão.
