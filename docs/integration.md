# Integração no produto anfitrião

## Contratos do SDK

`createStudio({ ai, repository, assets }).create(tenantId, input, company?, logo?)` continua sendo uma operação que aguarda a geração. Valida a entrada, salva uma intenção antes da IA e retorna o item concluído. `tenantId` vem da sessão autenticada; o anfitrião aplica permissões, limites, orçamento e auditoria.

`StudioRepository` mantém os contratos existentes:

- `claim(tenantId, input)` faz inserção atômica com unicidade `(tenant_id, id)` e retorna `{ created: false, item }` no conflito. Não implemente como SELECT seguido de INSERT sem proteção.
- `complete(tenantId, id, changes)` atualiza somente a organização e o ID informados; registro ausente deve gerar erro. Retorne cópias ou valores imutáveis.

`StudioReadRepository` acrescenta `get`, `list`, `updateCaption` e `archive`. É uma interface separada que estende `StudioRepository`; adapters antigos usados apenas em `createStudio` continuam compatíveis. `list` recebe `limit`, `cursor`, `kind`, `status` e `carousel_id`, devolvendo `{ items, meta: { cursor, has_more, total } }`. Autorize todos os métodos por organização e permita editar legenda somente em posts prontos.

`AssetStore.save(tenantId, id, bytes, options?)` recebe PNG validado; `options.format` indica `feed`, `square` ou `story`. O quarto argumento é opcional e mantém adapters antigos compatíveis. O tamanho de geração pode diferir do formato final: o adapter do app recorta com Sharp para `formats[format].size`, cria miniatura WebP e salva arquivos privados. Em outros hosts, implemente esse recorte ou documente o formato entregue. Forneça URLs temporárias por backend; limpeza de órfãos, retenção e exclusão física ficam com o anfitrião.

UUIDs são normalizados para lowercase. O mesmo UUID devolve a intenção já existente mesmo se um payload posterior mudar. Não repita uma chamada paga automaticamente após falha ambígua. `examples/memory.mjs` ilustra o contrato, mas perde dados no restart e não atende produção distribuída.

Logo vem do storage da organização autenticada. `createStudio` valida assinatura PNG/JPEG e limite de 5 MB; a associação à organização é responsabilidade do anfitrião. Funções de baixo nível de `createAi` recebem entradas previamente validadas. Textos, páginas pesquisadas e dados da marca são conteúdo, não instruções privilegiadas.

## Autenticação e marca no aplicativo

`server/runtime.ts` resolve um contexto por requisição: usuário em `requireAuth(request)`, organização e papel em `resolveActiveOrg(user)`, marca em `companyContext(orgId)`. O handler usa esse contexto em leitura, arquivos, criação, edição, retry e arquivamento. Escrita exige papel `admin`, `owner` ou `editor`.

Os adapters em `lib/auth/server.ts` retornam identidade local fixa; substitua-os pelo login e seleção de organização do seu produto, junto com `hooks/auth/AuthProvider.tsx`. A proteção de Host/Origin limita o exemplo a loopback. Ao hospedar, adapte também a política de origens e os cookies de sessão. Não há login de produção nem OAuth da Meta implementados.

`lib/instagram/brand.ts` é consultado tanto pelas páginas quanto pelo backend. A implementação de exemplo salva a descrição usada nas criações por organização; nome e cor ainda são exemplos. Para usar logo, retorne `logoPath` privado dentro do diretório de assets da organização. `loadLogo` valida o caminho e a imagem antes da geração. No seu storage, substitua esse loader e mantenha a verificação de propriedade do arquivo.

## HTTP e fila de geração

As rotas retornam `{ data: ... }` no sucesso e `{ error: { code, message, request_id, fields? } }` na falha. Métodos não suportados recebem 405 com `Allow`; validação/JSON inválido recebem 400, body maior que 20 KB recebe 413, item ausente recebe 404 e conflitos recebem 409. Erros do provedor são sanitizados; logs estruturados incluem identificadores e status, sem payloads ou credenciais.

| Operação       | Rota e comportamento                                                                |
| -------------- | ----------------------------------------------------------------------------------- |
| Criar          | `POST /api/v1/instagram`: 202 para post/pesquisa, 200 para referência local         |
| Listar         | `GET /api/v1/instagram?limit=24&kind=post&status=ready`: `data.items` e `data.meta` |
| Consultar      | `GET /api/v1/instagram/{id}`                                                        |
| Editar legenda | `PATCH /api/v1/instagram/{id}` com `{ caption }`, somente post pronto               |
| Arquivar       | `DELETE /api/v1/instagram/{id}`, bloqueado enquanto gera                            |
| Refazer falha  | `POST /api/v1/instagram/{id}/retry`: nova intenção e 202                            |
| Carrossel      | `POST /api/v1/instagram/carousels`: oito intenções persistidas atomicamente e 202   |
| Estado da IA   | `GET /api/v1/instagram/config`: demo, configurado ou incompleto                     |

Listagem usa cursor opaco: repasse `data.meta.cursor` à próxima requisição com os mesmos filtros. `meta.total` conta os itens elegíveis antes do cursor. Arquivamento retira o item das consultas; preserva registro, arquivos e histórico de consumo. Miniaturas usam `/api/assets/{id}?thumbnail=1`; downloads usam a imagem completa.

O aplicativo persiste intenção, reserva de cota e job em uma transação SQLite antes de chamar a IA. Um worker processa uma geração por vez, independente da aba do navegador. Ele inicia na criação ou leitura da biblioteca enquanto o processo Next.js estiver ativo; jobs aguardando sobrevivem ao restart e continuam quando o worker é iniciado novamente. Jobs em execução há mais de dez minutos são marcados como falha para inspeção. Isso não prova ausência de cobrança e não dispara retry pago automático.

`generateClaimed` existe para um worker anfitrião gerar uma intenção já inserida. Só chame depois de obter claim exclusivo e durável do job; o método não implementa a fila nem impede duplicação sozinho. Em múltiplas instâncias, use seu banco e executor distribuído. Um processo serverless efêmero não substitui um worker permanente.

Retry cria novo UUID e arquiva a intenção anterior numa transação. Exiba o aviso de possível cobrança e solicite ação explícita do usuário; antes de reenviar pedidos incertos, confira o histórico do provedor.

## Carrossel

No aplicativo, gere um UUID de grupo e oito UUIDs de slides e envie **uma única requisição**:

```json
{
  "id": "UUID_DO_GRUPO",
  "item_ids": ["UUID_1", "UUID_2", "UUID_3", "UUID_4", "UUID_5", "UUID_6", "UUID_7", "UUID_8"],
  "template": "noticia_impacto_operacional",
  "brief": "Descreva a novidade, a fonte e o impacto no negócio.",
  "niche": "Consultoria de negócios",
  "use_logo": true,
  "format": "feed"
}
```

Os textos `UUID_*` acima são placeholders: substitua por UUIDs reais. Repita os mesmos IDs ao consultar/reconciliar a requisição; um grupo já registrado não pode ganhar IDs de slides diferentes implicitamente. `carousel_id` permite buscar o grupo inteiro. Cada slide reserva uma geração, e apenas o primeiro gera legenda.

Ao usar somente o SDK, o anfitrião pode coordenar oito entradas `kind: 'post'` com `carousel: { id, template, slide: 1..8 }` em sua própria fila. `carouselTemplates` contém o roteiro; `carouselSlideBrief` cria a direção de cada slide. Orientações iguais não garantem consistência visual perfeita: revise cada slide. Referências não licenciam copiar fotos, marcas ou textos de terceiros.

## Modelos e limites

Crie o adapter com `createAi(transport, { image, text }, { imageSizes? })`. Por padrão, `feed` e `story` usam `1024x1536`; `square` usa `1024x1024`. Overrides são opcionais e validados na inicialização. GPT Image 1, 1-mini e 1.5 aceitam os tamanhos standard; modelos com tamanhos personalizados exigem dimensões em múltiplos de 16, razão entre 1:3 e 3:1 e limites de pixels/arestas. Consulte a [referência oficial](https://developers.openai.com/api/reference/resources/images/methods/generate) para o modelo escolhido. A validação não confirma disponibilidade na conta, crédito ou geração real.

O app lê `apps/studio/.env.local`; `.env` na raiz não é uma configuração automática do app. `OPENAI_API_KEY`, `OPENAI_IMAGE_MODEL` e `OPENAI_TEXT_MODEL` devem estar presentes juntos. Modelos/tamanhos incompatíveis produzem estado incompleto; biblioteca e referências locais permanecem consultáveis. Pesquisa requer modelo com `web_search` na Responses API.

`STUDIO_DAILY_GENERATION_LIMIT` limita novos jobs por organização/dia UTC; padrão 20. Pesquisa conta um, carrossel conta oito, referência não conta. Falhas continuam reservadas, e retry com novo UUID conta novamente. `STUDIO_DAILY_BUDGET_USD` habilita orçamento estimado e exige `STUDIO_ESTIMATED_GENERATION_COST_USD` positivo. A reserva é baseada nesse valor por job e não mede tokens, imagens ou cobrança real. Integre medição real, quotas adicionais e auditoria financeira quando necessário.

## Publicação

1. Autentique e autorize; resolva chave/perfil pelo tenant.
2. Valide com `publicationInput`, carregue os itens por tenant e confira que estão prontos.
3. Use `instagramContext` e `requireInstagramAccount` para verificar a conta ativa do perfil.
4. Prepare mídia aceita pelo provedor e URLs HTTPS temporárias. O SDK não converte o PNG para outro formato.
5. Persista uma intenção de publicação por `(tenant, id)` antes de chamar `publishInstagram(key, input, urls)`. Operações `sending`, `pending` ou `uncertain` devem ser consultadas, sem reenvio automático.
6. Salve recibo e estado. Use `readInstagramPublication` pelo ID conhecido ou `findInstagramPublication` pelo UUID após timeout.

`publishInstagram` envia imediatamente e não oferece sozinho persistência, autenticação ou autorização. Headers e metadata ajudam a correlacionar; não substituem claim atômico. Reconciliação consulta apenas os 100 registros retornados: não encontrar não prova ausência. Só o recibo da conta alvo com `published` confirma publicação. Permalink inválido resulta em `null` e preserva essa confirmação.

O aplicativo local mantém publicação e telas sociais desconectadas; integrar uma chave não as habilita automaticamente. Não existe variável `ZERNIO_API_KEY` consumida pelo app nesta versão. Conecte explicitamente os adapters sociais, armazenamento de credenciais e autorização do seu produto.

## Comentários, Direct e métricas

`mutateAutomation(context, input)` valida a operação e a propriedade de conta, postagem e regra. A criação vai ao executor Zernio; o SDK não executa Direct localmente. Ativar uma regra pode enviar mensagens reais. O anfitrião fornece permissões de gerenciamento, ação explícita e auditoria.

Para logs, liste `instagramAutomations(context)`, verifique que o ID pertence à organização e consulte `comment-automations/{id}/logs?limit=50` com `socialRequest`, validando com `automationLogSchema`. `instagramInsights` consulta contas Instagram ativas do perfil e preserva as métricas indisponíveis; ausência não é zero. Mensagem enviada não prova leitura, lead ou venda.

## Dados locais e migração

`STUDIO_DATA_DIR` escolhe a pasta; padrão `apps/studio/.studio-data` ao executar pelos scripts do workspace. SQLite guarda itens, índices, fila e contexto, com WAL e sincronização completa. Assets ficam em diretórios separados derivados do hash da organização, com UUIDs validados, gravação temporária, sincronização e rename. Não são arquivos públicos.

Antes de atualizar, pare o processo e faça backup da pasta inteira. A primeira abertura valida `items.json`, copia para `items.pre-sqlite.json` e importa numa transação. O original é preservado; arquivo inválido bloqueia a migração, sem descarte silencioso. Imagens legadas do tenant local continuam acessíveis. Intenções antigas em geração viram falha para revisão, sem chamadas adicionais.

O adapter local atende uma instalação em disco persistente. Para produção distribuída, forneça banco com unicidade e índices por tenant, storage privado e fila dedicada. Os testes usam `STUDIO_DATA_DIR` temporário e não escrevem na biblioteca pessoal.

## Referência anterior

As telas executáveis ficam em `apps/studio/features/instagram/components/`; contratos vêm de `packages/core`. `docs/legacy/api/` conserva handlers do CRM apenas para comparação. Migrations originais e serviços de billing, CRM e OAuth não são instaladores deste pacote: implemente os contratos no seu produto.

## Diagnóstico no servidor

Respostas de erro incluem `error.request_id` e `X-Request-ID`; procure esse ID no evento JSON `studio_request_failed`. Para erros 500, o log contém `error.name`, `message`, `stack` e `cause` recursiva sanitizada. Não devolva esses detalhes ao navegador nem anexe body, headers ou respostas brutas de provedores aos logs.

`studio_job_failed` identifica job/item e preserva a causa antes de atualizar o estado. `studio_worker_failed` descreve problemas de infraestrutura e informa `retry_in_ms` e `attempt`. Tentativas usam esperas crescentes até 60 segundos; o mesmo erro é registrado no máximo uma vez por minuto. Depois de corrigir o armazenamento, o worker retoma sem reiniciar. Um diagnóstico de JSON aponta o arquivo ou registro inválido, sem copiar seu conteúdo. Preserve e recupere os dados antes de retomar; o mecanismo não repete automaticamente chamadas pagas com resultado incerto.
