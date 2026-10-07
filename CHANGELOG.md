# Mudanças

## 0.2.1 · 07/10/2026

- N-02: na primeira execução do worker em um novo processo, jobs `running` herdados viram falha imediatamente; a fila continua sem esperar dez minutos e sem repetir chamadas ambíguas. Reloads no mesmo processo preservam a execução atual.
- N-03: prompts de todos os formatos incluem proporção final, recorte central e área segura com margem, calculados a partir do tamanho de geração configurado. Isso vale para post único, carrossel e edição com logo.
- Regressões cobrem queda real por SIGKILL com job recente, retomada de pedidos novos e prompts padrão/personalizados sem consumir créditos.

## Correção complementar A-02 · 07/10/2026

- Logs de erros 500 e falhas de jobs/worker incluem nome, mensagem, stack e causas sanitizadas no servidor; resposta pública permanece genérica.
- Falhas de migração/JSON identificam a origem sem registrar conteúdo privado.
- Worker espera progressivamente após falhas de infraestrutura e deduplica o mesmo erro; recuperação retoma a fila no mesmo processo.
- Testes de privacidade, repetição e corrupção real de storage incorporados ao CI.

## 0.2.0

Correções da auditoria, com preservação da estrutura visual do módulo original.

- Tailwind volta a incluir as classes de `features/`; regressão de estilos verificada no navegador.
- API usa rotas e métodos exatos, status apropriados, validação de campos e logs estruturados com ID da requisição e mensagens sanitizadas.
- Persistência local migra de JSON para SQLite com índices, paginação por cursor, filtros e leitura direta por ID; migração preserva backup validado do JSON e acesso aos assets antigos.
- Geração responde 202 e usa fila persistente. Carrosséis são registrados numa requisição, com oito intenções; worker processa um job por vez, independentemente da aba.
- Jobs interrompidos são marcados como falha sem reenvio pago automático. Retry explícito usa novo UUID e arquiva a intenção anterior atomicamente; posts e pesquisas podem ser arquivados.
- Sessão, tenant, permissões e marca são resolvidos por requisição e conectados aos adapters. O login fornecido permanece uma identidade local; OAuth e conexão social real continuam responsabilidades do anfitrião.
- Contexto usado na criação é salvo por organização; logo privado passa pelo loader da marca e pela validação PNG/JPEG.
- Cota diária por organização e reserva opcional de orçamento estimado em USD; não representa cobrança real do provedor.
- Tamanhos de geração compatíveis por padrão e overrides `OPENAI_IMAGE_SIZE_*`, validados antes da chamada. Adapter local aplica recorte final e miniaturas WebP privadas.
- UUIDs normalizados para lowercase; permalink inválido preserva publicação confirmada; caminhos e IDs dos adapters Zernio são validados internamente.
- Simulação renderiza o texto do briefing; pesquisa em demo explica a indisponibilidade. Textos, semântica e indicadores da interface alinhados ao contrato atual.
- `StudioReadRepository` estende os ports de criação; `generateClaimed` atende workers com claim próprio; quarto argumento opcional de `AssetStore.save` informa formato sem quebrar adapters anteriores.
- Testes HTTP/navegador usam `STUDIO_DATA_DIR` temporário; providers recebem cobertura com fetch simulado para publicação, reconciliação, automações e métricas.
- Dependência local do SDK por `file:`, atualização de dependências, lint/Prettier, verificação no CI, fontes locais e cabeçalhos de segurança.
- Runtime do workspace requer Node 22.13+ devido a `node:sqlite`; a distribuição do SDK permanece por tarball, sem publicação npm.

### Migração

1. Pare o aplicativo e faça backup de `apps/studio/.studio-data/` ou do diretório configurado.
2. Atualize para Node 22.13+ e execute `npm ci` na raiz.
3. Use `apps/studio/.env.local`; revise tamanhos, limite diário e orçamento estimado.
4. Na primeira abertura, o JSON legado é validado e importado para `studio.sqlite`, com cópia em `items.pre-sqlite.json`. Arquivo inválido bloqueia a migração para recuperação. Gerações antigas pendentes são marcadas como falha, sem chamada adicional.
5. Atualize consumidores HTTP: criação de post/pesquisa responde 202; listagem é `data.items` com `data.meta`; carrossel usa `/api/v1/instagram/carousels`.
6. Adapters existentes de `createStudio` continuam compatíveis. Para instalar o SDK fora do workspace, use o tarball `saraivabr-instagram-studio-kit-0.2.0.tgz`.

Testes automatizados usam simulação. Esta versão não declara geração paga, OAuth, publicação real ou entrega de Direct verificados com provedores conectados.

## 0.1.1

- Workspace npm com uma instalação e um lockfile para aplicativo e SDK.
- Núcleo em `packages/core`, separado em domínio, aplicação e provedores; API pública preservada, com imports por área.
- Telas originais em `apps/studio/features/instagram`; rotas leves, sem alteração do layout.
- HTTP, composição, persistência, imagens e simulação em módulos separados.
- Contratos duplicados removidos da interface; referência antiga isolada em `docs/legacy`.
- Verificação HTTP inicia e encerra seu servidor automaticamente.

Migração: substitua instalações com `file:/caminho/do/repositorio` por `file:/caminho/do/repositorio/packages/core` ou use o arquivo gerado por `npm run pack:core`. Execute `npm ci` somente na raiz; não há mais instalação separada do aplicativo. Para executar o exemplo, use `npm run dev`.
