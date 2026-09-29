<div align="center">

# Instagram Studio Kit

**Leve um estúdio de conteúdo para dentro da sua solução.**

Criação de artes e carrosséis, revisão de conteúdo e integrações de Instagram — com a interface original do escreve.ai e um núcleo TypeScript reutilizável.

[Começar](#comece-em-poucos-passos) · [Integrar](#integre-do-seu-jeito) · [Arquitetura](docs/architecture.md) · [Contribuir](CONTRIBUTING.md)

</div>

![Interface do Instagram Studio](docs/studio-preview.png)

## Do briefing à revisão

A pessoa descreve seu negócio e o que quer comunicar. O estúdio prepara a arte e a legenda, organiza as criações na biblioteca e permite revisar, editar e baixar o conteúdo antes de compartilhar.

Para quem desenvolve, o projeto oferece duas portas de entrada: um aplicativo Next.js com as telas prontas e um SDK independente para incorporar as funcionalidades à interface que você já tem.

| Recurso | O que você pode incorporar |
| --- | --- |
| **Artes com IA** | Imagem e legenda para post vertical, quadrado ou Story |
| **Carrosséis** | Roteiro de oito slides, com sequência narrativa e revisão por slide |
| **Identidade visual** | Nome, contexto, cor e logo da empresa na geração |
| **Biblioteca e revisão** | Histórico de pedidos, edição de legenda e download da imagem |
| **Referências** | Perfis salvos e pesquisa com fontes verificáveis quando a IA está configurada |
| **Publicação** | Adapters para publicar e consultar recibos via Zernio |
| **Comentários e Direct** | Adapters para criar, editar e ativar automações no provedor social |
| **Resultados** | Consulta de métricas da conta conectada via Zernio |

As telas preservam o layout, a navegação, os componentes, as fontes e as animações do módulo original. Publicação, automações e métricas reais dependem da integração dos serviços do seu produto com o provedor social.

## Comece em poucos passos

Você precisa de **Node.js 22 ou superior** e npm.

```bash
git clone https://github.com/saraivabr/instagram-studio-kit.git
cd instagram-studio-kit
npm ci
npm run dev
```

Abra **[o estúdio local](http://127.0.0.1:4318/app/instagram)**.

A primeira execução funciona sem credenciais: gera artes identificadas como demonstração e permite experimentar criação, biblioteca e revisão. Os pedidos e arquivos ficam em `apps/studio/.studio-data/`, fora do Git. Publicação e envio de Direct permanecem bloqueados no exemplo local.

### Habilite a criação com IA

```bash
cp apps/studio/.env.example apps/studio/.env.local
```

Preencha o arquivo no servidor:

```dotenv
OPENAI_API_KEY=sua_chave
OPENAI_IMAGE_MODEL=modelo_de_imagem_compativel
OPENAI_TEXT_MODEL=modelo_de_texto_compativel
```

Use modelos disponíveis na sua conta que suportem os endpoints e formatos solicitados. Reinicie o aplicativo depois de configurar. As chamadas reais têm custo no provedor; a chave nunca deve usar o prefixo `NEXT_PUBLIC_`.

## Integre do seu jeito

### 1. Quero o estúdio completo

Use **`apps/studio/`** como base. As telas ficam em `features/instagram/components/`, e as rotas Next.js apenas compõem as páginas.

Conecte os seguintes pontos aos serviços que sua solução já utiliza:

| Ponto de integração | Onde começar |
| --- | --- |
| Sessão, usuário e organização | `lib/auth/server.ts` e `hooks/auth/AuthProvider.tsx` |
| Cadastro e identidade da empresa | `lib/instagram/brand.ts` |
| Banco e armazenamento de imagens | `server/adapters/local/` |
| Provedor de IA | `server/runtime.ts` |
| API e serviços sociais | `server/http/handler.ts` |
| Idioma | `hooks/i18n/` |

Os caminhos dessa tabela são relativos a `apps/studio/`. O exemplo utiliza identidade fixa e persistência local para uma organização. Para hospedar, substitua essas implementações por autenticação, isolamento e armazenamento privados do seu produto.

### 2. Quero apenas as funcionalidades

Use **`packages/core/`**. O SDK não depende de Next.js nem do CRM e mantém contratos separados da infraestrutura.

Gere o pacote:

```bash
npm run pack:core
```

Instale o arquivo `.tgz` gerado no projeto que vai receber o módulo:

```bash
npm install /caminho/saraivabr-instagram-studio-kit-0.1.1.tgz
```

Exemplo de composição no seu backend:

```ts
import { createStudio } from "@saraivabr/instagram-studio-kit/studio";
import { createAi, openAiTransport } from "@saraivabr/instagram-studio-kit/ai";

const ai = createAi(openAiTransport(process.env.OPENAI_API_KEY!), {
  image: process.env.OPENAI_IMAGE_MODEL!,
  text: process.env.OPENAI_TEXT_MODEL!,
});

// Implemente os contratos usando o banco e o storage da sua solução.
const studio = createStudio({
  ai,
  repository: seuRepositorio,
  assets: seuArmazenamento,
});

// Resolva a organização pela sessão autenticada, nunca pelo body do pedido.
const item = await studio.create(sessao.organizationId, {
  id: crypto.randomUUID(),
  kind: "post",
  format: "feed",
  niche: "Consultoria de negócios",
  brief: "Como organizar o atendimento para responder melhor aos clientes.",
}, { name: "Sua empresa", accent: "#506d48" });
```

`seuRepositorio`, `seuArmazenamento` e `sessao` representam serviços fornecidos pelo seu aplicativo. O [guia de integração](docs/integration.md) detalha seus contratos, a idempotência e a recuperação de falhas.

| Import | Responsabilidade |
| --- | --- |
| `@saraivabr/instagram-studio-kit` | API completa do SDK |
| `@saraivabr/instagram-studio-kit/studio` | Caso de uso de criação e contratos de persistência |
| `@saraivabr/instagram-studio-kit/schemas` | Validação, formatos e roteiro de carrossel |
| `@saraivabr/instagram-studio-kit/ai` | Geração, legenda, pesquisa e transporte OpenAI |
| `@saraivabr/instagram-studio-kit/social` | Contas, publicação, automações e métricas via Zernio |

O SDK ainda **não está publicado no npm**. A distribuição desta versão é pelo repositório e pelo arquivo gerado com `pack:core`.

## Estrutura do projeto

```text
instagram-studio-kit/
├── apps/studio/                 Aplicativo com a interface original
│   ├── app/                     Rotas e layouts Next.js
│   ├── features/instagram/      Telas e componentes do módulo
│   ├── components/              Componentes visuais compartilhados
│   ├── hooks/                   Idioma e identidade local
│   └── server/                  HTTP, composição e adapters
├── packages/core/               SDK TypeScript independente
│   └── src/
│       ├── domain/              Schemas, formatos e carrosséis
│       ├── application/         Casos de uso e contratos
│       └── providers/           OpenAI e Zernio
├── examples/                    Exemplo mínimo do SDK
├── tests/                       Testes do núcleo e da integração HTTP
├── scripts/                     Execução da verificação do aplicativo
└── docs/                        Integração, arquitetura e referência legada
```

Um workspace, uma instalação e um lockfile. Os contratos têm uma única fonte em `packages/core/`; a interface os importa diretamente. O conteúdo de `docs/legacy/` serve apenas para consultar a API anterior e fica fora dos builds e do pacote distribuído.

## Desenvolva e valide

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Compila o núcleo e inicia o estúdio na porta 4318 |
| `npm run build` | Compila o SDK e o aplicativo |
| `npm run start` | Inicia o aplicativo já compilado |
| `npm test` | Verifica contratos, isolamento, idempotência e falhas do núcleo |
| `npm run typecheck` | Confere os tipos dos dois workspaces |
| `npm run test:app` | Testa o aplicativo compilado em um servidor temporário |
| `npm run verify` | Executa testes, tipos, build e verificação HTTP |
| `npm run pack:core` | Empacota apenas o SDK reutilizável |
| `npm run demo:sdk` | Inicia o exemplo mínimo na porta 4317 |

Os testes usam simulação e não realizam chamadas pagas, publicações ou envio de mensagens. A validação de OAuth, métricas, publicação e entrega de Direct deve acontecer com o provedor conectado à sua solução.

## O que fica com o seu produto

Você fornece autenticação, permissões, isolamento por organização, banco, armazenamento privado, orçamento de IA e auditoria. A conexão social utiliza adapters Zernio; este projeto não implementa OAuth direto da Meta.

Geração e publicação são operações separadas. O conteúdo precisa ser revisado, e uma publicação só é confirmada pelo recibo da conta escolhida. Pedidos com resultado incerto devem ser reconciliados antes de repetir o envio.

O CRM completo, kanban e cobrança ficam fora deste módulo. Os links correspondentes no aplicativo local indicam pontos de integração.

## Documentação e contribuição

- [Guia de integração](docs/integration.md) — persistência, autorização, carrosséis e publicação.
- [Arquitetura](docs/architecture.md) — camadas e pontos de substituição.
- [Contribuir](CONTRIBUTING.md) — convenções e verificações.
- [Mudanças](CHANGELOG.md) — versões e migração.

## Origem e licença

Extraído do módulo de Instagram do [escreve.ai / DeskcommCRM](https://github.com/saraivabr/DeskcommCRM), distribuído sob a [licença MIT](LICENSE).

Preserve `LICENSE` e [NOTICE](NOTICE) ao reutilizar ou redistribuir. Credenciais, dados de clientes, mídia privada e histórico Git do CRM não fazem parte deste repositório.
