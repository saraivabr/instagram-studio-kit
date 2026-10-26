# Mudanças

## 0.6.0 · 25/10/2026

Correções da análise de 25/10/2026.

- **Compatibilidade (SDK):** `BrandPerson.consentAt` (ISO 8601) passa a ser exigido por `create`/`generateClaimed` quando há `person_id`. Hosts devem repassar a data em que registraram a autorização; o app já envia `consent_at`.
- **Compatibilidade (SDK):** carrossel só aceita `format: "feed"`, a proporção 4:5 que o brief dos slides descreve. O app já enviava `feed`.
- `safeSource` recusa hosts internos (localhost, `.local`, IPs de loopback, privados, link-local, CGNAT e IPv6 equivalentes) em mídias de publicação e citações de pesquisa.
- `generateClaimed` marca como falha um item com entrada inválida, em vez de deixá-lo em `generating`. Se gravar a falha também der erro, o erro original é mantido e o de armazenamento vai em `cause`.
- Worker: a fila é liberada mesmo quando gravar a falha do item dá erro. Antes o job ficava `running` e bloqueava a fila por 10 minutos.
- Logo: troca e limpeza de logos da mesma organização são serializadas. Antes, uma limpeza concorrente podia apagar o logo recém-enviado.
- Conferência de publicação percorre até 10 páginas de 100 posts da Zernio, em vez de só os 100 mais recentes.
- Automações: palavras-chave na mesma regra em outra ordem não geram mais conflito 409; um registro malformado da Zernio é ignorado em vez de derrubar a lista inteira.
- Tela inicial mostra o motivo quando a Zernio não está configurada, em vez de "Nenhuma regra". Remover o logo ou uma pessoa pede confirmação. O seletor de carrossel em Publicar carrega mais criações sob demanda.
- O pacote do SDK é `private`: `npm pack` continua funcionando, `npm publish` acidental é bloqueado. Documentação atualizada para o tarball 0.6.0.
- CI: execuções concorrentes do mesmo branch são canceladas, há limite de tempo e o tarball é instalado num projeto vazio para conferir os subpaths exportados.

## 0.5.0 · 25/10/2026

Parte opcional do pedido "Minha marca": rosto de uma pessoa nas artes.

- Seção **Pessoas da marca** em `/app/settings/marca`: nome, de 1 a 3 fotos de frente (PNG/JPG até 5 MB cada) e a caixa obrigatória "Tenho autorização desta pessoa para usar a imagem dela". A tela avisa que o rosto é aproximado, pode variar entre as artes e que nem todo provedor aceita referências.
- Na criação, a opção **Incluir [nome] na arte** para post único e para os 8 slides do carrossel (`person_id`).
- API `GET/POST /api/v1/brand/people`, `DELETE /api/v1/brand/people/<id>` e prévia autenticada em `/api/v1/brand/people/<id>/photos/<n>`. Só `admin`, `owner` e `editor` alteram; até 10 pessoas por organização.
- Privacidade: fotos privadas por organização, sem EXIF/GPS, limitadas a 1024 px, enviadas só ao provedor de imagem. Autorização registrada com data e usuário. Remover a pessoa apaga as fotos na hora; gerações ainda na fila falham sem chamar a IA em vez de usar a imagem.
- SDK: `BrandPerson`, `maxPersonPhotos` e quinto argumento `person` em `create`/`generateClaimed`/`createImage`. As fotos vão antes do logo em `image[]` (a primeira referência é a mais preservada), com `input_fidelity: "high"` em `gpt-image-1` e `gpt-image-1.5`. Pessoa ausente ou com fotos inválidas é recusada antes de qualquer chamada paga. Adapters e chamadas antigas continuam compatíveis.
- Segurança: Next.js 16.4.3 (GHSA-2464-fhr4-w9xw, GHSA-p3m5-59mp-jv5r, GHSA-673q-mjm6-r5xr) e zod 4.6.7 (GHSA-mrhx-c7xc-m3w5), para a auditoria de dependências do CI voltar a passar.
- Testes com IA simulada: validação e consentimento, remoção de metadados, ordem das referências, carrossel com pessoa, remoção com fila ativa e fluxo da tela no navegador. O rosto reconhecível na arte depende do provedor real e precisa ser conferido com créditos.

## 0.4.0 · 19/10/2026

- Tela **Minha marca** (`/app/settings/marca`, com link no menu e atalho "Editar marca" na criação): nome (até 100), atividade (até 2000), cor principal com seletor e hex, logo PNG/JPG de até 5 MB com prévia em fundo claro e escuro, trocar e remover.
- API `GET/PUT /api/v1/brand` e `GET/POST/DELETE /api/v1/brand/logo` (upload multipart com limite próprio de 5 MB). Só `admin`, `owner` e `editor` alteram; os demais só veem. O logo é privado por organização e servido por rota autenticada.
- Tabela `brands` ampliada (`name`, `accent`, `logo_path`, `logo_mode`, `updated_at`) por migração automática; `companyContext` lê tudo dela e mantém os valores padrão quando não há cadastro.
- Logo validado por assinatura (SVG, PDF e WebP recusados com mensagem clara), normalizado com sharp (sem metadados, maior lado até 1024 px, transparência preservada) e gravado com arquivo temporário + rename, com nome novo a cada envio.
- Trocar ou remover o logo não quebra gerações na fila: o arquivo antigo só é apagado quando nenhum job o usa.
- Dois modos de aplicar o logo: **arquivo original no canto** (padrão; a IA gera a arte sem logo e o servidor aplica o arquivo dentro da área segura de 8%) ou **IA desenha o logo**, que envia a referência com `input_fidelity: "high"` nos modelos que suportam (`gpt-image-1` e `gpt-image-1.5`). Vale também para os 8 slides do carrossel.
- SDK: `CompanyContext.logoMode` (`"ai"` ou `"stamp"`) e `AssetStore.save(..., { logo })`; adapters antigos continuam compatíveis.
- Fora desta versão: fotos de pessoas nas artes (parte opcional do pedido), que exige consentimento, privacidade e múltiplas imagens de referência.

## 0.3.0 · 14/10/2026

- Patch de segurança do Next.js 16.3.8 para atender a auditoria de dependências.
- Integração Zernio executável no aplicativo: configurar chave, resolver perfil por organização, conectar/reconectar/desconectar conta profissional.
- Publicação de feed, carrossel e Story com JPEG privado, upload presignado, intenção durável, exclusão de envios duplicados e reconciliação sem reenvio.
- Métricas e automações ligadas ao SDK; mutações de automações exigem confirmação explícita.
- Z-01–Z-05: recibo sem accountId em alvo único, timeout maior no envio, 409 em processamento, cancelled terminal e mensagens distintas para 401/403.
- Testes com Zernio simulada; publicação/OAuth em conta profissional real exigem validação autorizada.

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
