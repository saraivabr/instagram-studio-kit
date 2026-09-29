# Instagram Studio Kit

O módulo de Instagram do escreve.ai, com a mesma interface, organizado para integrar a outros produtos. Artes, carrosséis, referências, revisão, métricas e automações sociais em um aplicativo Next.js e um SDK TypeScript independente.

![Interface do Instagram Studio](docs/studio-preview.png)

## Comece aqui

Node.js 22 ou superior. Um workspace, uma instalação e um lockfile:

```bash
git clone https://github.com/saraivabr/instagram-studio-kit.git
cd instagram-studio-kit
npm ci
npm run dev
```

Abra http://127.0.0.1:4318/app/instagram. Sem credenciais, as artes são explicitamente simuladas. A interface mantém as telas, animações, fontes, componentes e navegação do módulo original. Publicações e Direct ficam bloqueados até integrar uma conta real.

## Organização

```text
apps/studio/
  app/                       Rotas e layouts Next.js
  features/instagram/        Telas do módulo original
  components/                Componentes visuais compartilhados
  hooks/                     Adapters de idioma e identidade local
  server/
    http/                    Validação e respostas HTTP
    adapters/local/          Persistência e imagens locais
    adapters/demo/           IA simulada
    runtime.ts               Composição de SDK e adapters
packages/core/
  src/domain/                Schemas, formatos e roteiro de carrossel
  src/application/           Casos de uso e contratos de persistência
  src/providers/openai/      Geração, legenda e pesquisa
  src/providers/zernio/      Contas, publicação, automações e métricas
examples/                    Exemplo mínimo do SDK, sem Next.js
scripts/                     Verificação do aplicativo
tests/                      Testes do núcleo e da integração HTTP
docs/                       Guia de integração, arquitetura e API anterior
```

O SDK é a única fonte dos contratos. A interface importa esses contratos pelo workspace; não mantém cópias de schemas. O código em `docs/legacy/` é referência histórica, fora dos builds e do pacote distribuído.

## Escolha como integrar

**Quero a interface completa:** use `apps/studio/`, preservando as telas em `features/instagram/`. Troque a sessão local, o repositório, o armazenamento e as conexões sociais pelos serviços do seu produto.

**Quero apenas o núcleo:** use `packages/core/`. O pacote mantém o nome `@saraivabr/instagram-studio-kit` e oferece imports por área:

```ts
import { createStudio } from "@saraivabr/instagram-studio-kit/studio";
import { createAi, openAiTransport } from "@saraivabr/instagram-studio-kit/ai";
import { createSchema } from "@saraivabr/instagram-studio-kit/schemas";
import { instagramContext } from "@saraivabr/instagram-studio-kit/social";
```

Para distribuir o SDK sem o aplicativo:

```bash
npm run pack:core
# No aplicativo que vai receber o SDK:
npm install /caminho/saraivabr-instagram-studio-kit-0.1.1.tgz
```

Não está publicado no npm. Veja o [guia de integração](docs/integration.md) para os contratos de armazenamento, autorização e reconciliação de publicações; o [mapa da arquitetura](docs/architecture.md) mostra onde implementar cada adapter.

## Configuração e comandos

`apps/studio/.env.example` documenta chave e modelos de IA. Copie para `.env.local` e use modelos compatíveis com os endpoints e formatos solicitados. Com credenciais, a criação tem custo no provedor. Credenciais ficam no backend.

| Comando             | Resultado                                                       |
| ------------------- | --------------------------------------------------------------- |
| `npm ci`            | Instala os dois workspaces e compila o núcleo                   |
| `npm run dev`       | Compila o núcleo e inicia a interface original                  |
| `npm run build`     | Compila SDK e aplicativo                                        |
| `npm run start`     | Inicia o aplicativo já compilado                                |
| `npm test`          | Testa contratos, isolamento, idempotência e falhas do SDK       |
| `npm run test:app`  | Inicia um servidor de teste, verifica HTTP e encerra o servidor |
| `npm run verify`    | Testes, tipos, build e verificação HTTP completos               |
| `npm run pack:core` | Gera somente o pacote reutilizável                              |
| `npm run demo:sdk`  | Abre o exemplo mínimo do SDK na porta 4317                      |

O exemplo é local e de uma organização; `.studio-data/` persiste os itens e imagens, sem entrar no Git. Para hospedar, substitua identidade fixa, JSON local e guards pelos serviços autenticados do seu produto. O kanban e cobrança do CRM ficam fora deste módulo; seus links são pontos de integração.

Os testes não realizam chamadas pagas, publicações ou envio de Direct. Métricas e recebimento de mensagens reais exigem validação com seu provedor.

## Origem e licença

Extraído do [escreve.ai / DeskcommCRM](https://github.com/saraivabr/DeskcommCRM), MIT. Preserve `LICENSE` e `NOTICE`. Credenciais, dados de clientes, mídia privada e histórico Git do CRM não são distribuídos.
