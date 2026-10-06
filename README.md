<div align="center">

# Instagram Studio Kit

**Leve um estúdio de conteúdo para dentro da sua solução.**

Artes, carrosséis, revisão e biblioteca com o layout original do módulo Instagram do escreve.ai — e um SDK TypeScript para usar no seu backend.

[Começar](#comece-em-poucos-passos) · [Integrar](#integre-do-seu-jeito) · [Arquitetura](docs/architecture.md) · [Contribuir](CONTRIBUTING.md)

</div>

![Interface do Instagram Studio](docs/studio-preview.png)

## Do briefing à revisão

Descreva o negócio e o que você quer comunicar. O estúdio cria a arte e a legenda, organiza o conteúdo e permite revisar, editar e baixar antes de compartilhar. As telas mantêm a navegação, os componentes, as fontes e as animações do módulo original.

| Recurso               | O que você pode incorporar                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------ |
| **Artes com IA**      | Post vertical, quadrado e Story, com imagem e legenda                                      |
| **Carrosséis**        | Oito slides enviados em uma única operação; a geração continua no servidor ao fechar a aba |
| **Identidade visual** | Nome, contexto, cor e logo fornecidos pelo cadastro da organização                         |
| **Biblioteca**        | Paginação, filtros, miniaturas, revisão e edição de legenda de posts prontos               |
| **Recuperação**       | Pedidos interrompidos podem ser refeitos com novo UUID; itens podem ser arquivados         |
| **Referências**       | Perfis salvos e pesquisa com fontes verificáveis quando a IA está configurada              |
| **Instagram**         | Adapters Zernio para publicação, recibos, automações e métricas                            |

O aplicativo local permite experimentar criação e revisão. Publicação, Direct e métricas reais exigem conectar os serviços sociais e a autorização do seu produto.

## Comece em poucos passos

Você precisa de **Node.js 22.13 ou superior**, npm e Git. O adapter local usa `node:sqlite`; dependendo da versão do Node, seu aviso experimental pode aparecer.

```bash
git clone https://github.com/saraivabr/instagram-studio-kit.git
cd instagram-studio-kit
npm ci
npm run dev
```

Abra **[o estúdio local](http://127.0.0.1:4318/app/instagram)**.

Sem credenciais, as artes são identificadas como demonstração e mostram o texto do pedido. Pesquisa real fica indisponível, e publicação e Direct ficam bloqueados. Pedidos, fila e imagens ficam em `apps/studio/.studio-data/`, fora do Git. Use `STUDIO_DATA_DIR` para escolher outra pasta; prefira um caminho absoluto e fora de pastas sincronizadas.

### Habilite a criação com IA

```bash
cp apps/studio/.env.example apps/studio/.env.local
```

Preencha **`apps/studio/.env.local`** no servidor e reinicie:

```dotenv
OPENAI_API_KEY=sua_chave
OPENAI_IMAGE_MODEL=gpt-image-1
OPENAI_TEXT_MODEL=modelo_disponivel_com_Responses_e_web_search
```

A chave e os dois modelos são obrigatórios para o estado “IA configurada”. Configuração incompleta é informada na interface e não impede consultar a biblioteca. Nunca coloque credenciais em `NEXT_PUBLIC_*`.

Os tamanhos de geração padrão são `1024x1536` para vertical/Story e `1024x1024` para quadrado, compatíveis com as famílias GPT Image 1, 1-mini e 1.5. O aplicativo recorta o resultado para **4:5**, **1:1** ou **9:16**. Para modelos com dimensões personalizadas, você pode configurar:

```dotenv
OPENAI_IMAGE_SIZE_FEED=1024x1280
OPENAI_IMAGE_SIZE_SQUARE=1024x1024
OPENAI_IMAGE_SIZE_STORY=1152x2048
```

Esses overrides exigem um modelo compatível, como GPT Image 2; tamanhos incompatíveis são recusados antes da chamada. Consulte a [referência oficial de imagens](https://developers.openai.com/api/reference/resources/images/methods/generate) e a disponibilidade da sua conta. A compatibilidade foi verificada por validação e transporte simulado; esta versão não afirma teste de geração pago com chave real.

### Limites de geração

O aplicativo reserva no banco **20 gerações por organização por dia UTC**, por padrão. Uma pesquisa conta como uma geração; um carrossel completo reserva oito. Duplicar o mesmo UUID não reserva nem gera de novo. Tentativas novas e pedidos que falharam contam para o limite.

```dotenv
STUDIO_DAILY_GENERATION_LIMIT=20
# Opcional: orçamento diário em USD, baseado em estimativa por geração.
STUDIO_DAILY_BUDGET_USD=5
STUDIO_ESTIMATED_GENERATION_COST_USD=0.25
```

O orçamento exige estimativa positiva. Essa reserva evita ultrapassar o valor estimado; **não mede a cobrança real do provedor**. Para controle financeiro exato, integre consumo e preços no seu produto.

## Integre do seu jeito

### 1. Quero o estúdio completo

Use **`apps/studio/`** dentro do workspace. As telas ficam em `features/instagram/components/`; as rotas Next.js compõem as páginas. O app usa `file:../../packages/core`, sem buscar um SDK não publicado no registro npm.

| Ponto                            | Onde conectar seus serviços                                         |
| -------------------------------- | ------------------------------------------------------------------- |
| Sessão, organização e permissões | `lib/auth/server.ts` e `hooks/auth/AuthProvider.tsx`                |
| Cadastro, contexto, cor e logo   | `lib/instagram/brand.ts`; contexto resolvido em `server/runtime.ts` |
| Banco e fila de geração          | `server/adapters/local/repository.ts`                               |
| Imagens privadas e miniaturas    | `server/adapters/local/assets.ts`                                   |
| IA, configuração e execução      | `server/runtime.ts`                                                 |
| API e integrações sociais        | `server/http/handler.ts` e SDK `/social`                            |
| Idioma e interface               | `hooks/i18n/` e `features/instagram/components/`                    |

Os caminhos são relativos a `apps/studio/`. A API já usa o resolvedor de sessão, organização e marca para cada requisição, incluindo autorização de escrita. Os adapters fornecidos ainda retornam **uma identidade local fixa** e uma marca de exemplo: substitua-os junto com a identidade no frontend antes de hospedar. OAuth da Meta e login de produção não estão implementados.

A persistência local usa SQLite, paginação por cursor, leitura direta por ID e uma fila durável. Ela atende uma instalação em disco persistente. Para múltiplas instâncias ou serverless, conecte banco, storage privado e worker/fila da sua infraestrutura. Leia o [guia de integração](docs/integration.md) antes de copiar o app isoladamente.

### 2. Quero apenas as funcionalidades

Use **`packages/core/`**. O SDK independe de Next.js e do CRM.

```bash
npm run pack:core
# No projeto que vai receber o módulo:
npm install /caminho/saraivabr-instagram-studio-kit-0.2.0.tgz
```

O pacote **não está publicado no npm**. Distribua o tarball ou mantenha a dependência local; não substitua por um nome de registro sem verificar o publicador.

```ts
import { createStudio } from "@saraivabr/instagram-studio-kit/studio";
import { createAi, openAiTransport } from "@saraivabr/instagram-studio-kit/ai";

const ai = createAi(
  openAiTransport(process.env.OPENAI_API_KEY!),
  {
    image: process.env.OPENAI_IMAGE_MODEL!,
    text: process.env.OPENAI_TEXT_MODEL!,
  },
  // Opcional: tamanhos aceitos pelo modelo escolhido.
  { imageSizes: { feed: "1024x1536", story: "1024x1536" } },
);

const studio = createStudio({
  ai,
  repository: seuRepositorio,
  assets: seuArmazenamento,
});

const item = await studio.create(
  sessao.organizationId,
  {
    id: crypto.randomUUID(),
    kind: "post",
    format: "feed",
    niche: "Consultoria de negócios",
    brief: "Como organizar o atendimento para responder melhor aos clientes.",
  },
  { name: "Sua empresa", accent: "#506d48" },
);
```

`seuRepositorio`, `seuArmazenamento` e `sessao` são serviços do seu produto. `create` continua aguardando a geração; a fila assíncrona pertence ao aplicativo de exemplo ou à infraestrutura anfitriã. `AssetStore.save` recebe opcionalmente o formato final para seu adapter aplicar o recorte.

| Import                            | Responsabilidade                                 |
| --------------------------------- | ------------------------------------------------ |
| `@saraivabr/instagram-studio-kit` | API completa                                     |
| `/studio`                         | Criação e contratos de persistência/leitura      |
| `/schemas`                        | Validação, formatos e carrosséis                 |
| `/ai`                             | Geração, legenda, pesquisa e transporte OpenAI   |
| `/social`                         | Contas, publicação, automações e métricas Zernio |

## Estrutura do projeto

```text
instagram-studio-kit/
├── apps/studio/                 Aplicativo com a interface original
│   ├── app/                     Rotas e layouts Next.js
│   ├── features/instagram/      Telas e componentes do módulo
│   ├── components/              Componentes visuais compartilhados
│   ├── hooks/                   Idioma e identidade local
│   └── server/                  HTTP, worker, composição e adapters
├── packages/core/src/
│   ├── domain/                  Schemas, formatos e carrosséis
│   ├── application/             Casos de uso e contratos
│   └── providers/               OpenAI e Zernio
├── examples/                    Exemplo mínimo do SDK
├── tests/                       SDK, HTTP e regressão de interface
├── scripts/                     Verificação em ambiente temporário
└── docs/                        Integração, arquitetura e referência legada
```

Uma instalação e um lockfile; contratos com uma única fonte no SDK. `docs/legacy/` é referência do CRM anterior e fica fora dos builds e do pacote.

## Desenvolva e valide

| Comando                                 | O que faz                                                   |
| --------------------------------------- | ----------------------------------------------------------- |
| `npm run dev`                           | Compila o núcleo e abre o estúdio na porta 4318             |
| `npm run build` / `npm run start`       | Compila / inicia o aplicativo compilado                     |
| `npm test`                              | Testa núcleo e providers com simulação                      |
| `npm run typecheck`                     | Confere os tipos dos workspaces                             |
| `npm run lint` / `npm run format:check` | Confere lint e formatação                                   |
| `npm run format`                        | Aplica a formatação do projeto                              |
| `npm run test:app`                      | Verifica HTTP e interface com dados temporários isolados    |
| `npm run verify`                        | Lint, formatação, testes, tipos, build e verificação do app |
| `npm run pack:core`                     | Empacota o SDK                                              |
| `npm run demo:sdk`                      | Inicia o exemplo mínimo na porta 4317                       |

Testes de navegador exigem o Chromium do Playwright; instale-o com `npx playwright install chromium` se necessário. Os testes não usam chamadas pagas, publicações ou envio real de mensagens. Fontes são servidas localmente, sem download de fontes durante o build.

### Atualizando da versão 0.1.1

Pare o aplicativo, preserve uma cópia de `.studio-data/` e atualize as dependências com `npm ci`. Na primeira abertura, os registros de `items.json` são validados e migrados para `studio.sqlite`; o original é preservado e também copiado para `items.pre-sqlite.json`. Imagens antigas continuam acessíveis. Pedidos antigos presos em geração viram falha para revisão, sem reenvio pago automático. Um arquivo inválido interrompe a migração e deve ser preservado para recuperação.

O HTTP de criação agora responde **202** para geração; aguarde o item ficar pronto. A listagem devolve `data.items` e `data.meta` com cursor e total. Carrosséis são enviados a `/api/v1/instagram/carousels` de uma só vez. Adapte consumidores antigos conforme o [guia de integração](docs/integration.md).

## O que fica com o seu produto

Você fornece login real, permissões, serviços privados e a conexão social. Geração e publicação continuam separadas: revise o conteúdo, confirme pelo recibo da conta escolhida e reconcilie resultados incertos antes de reenviar. O CRM completo, kanban e cobrança ficam fora deste módulo.

- [Guia de integração](docs/integration.md) — contratos, fila, limites e publicação.
- [Arquitetura](docs/architecture.md) — camadas e adapters.
- [Contribuir](CONTRIBUTING.md) — convenções e verificações.
- [Mudanças](CHANGELOG.md) — versões e migração.

## Origem e licença

Extraído do módulo Instagram do [escreve.ai / DeskcommCRM](https://github.com/saraivabr/DeskcommCRM), distribuído sob [licença MIT](LICENSE). Preserve `LICENSE` e [NOTICE](NOTICE) ao reutilizar ou redistribuir. Credenciais, dados de clientes, mídia privada e histórico Git do CRM não fazem parte deste repositório.
