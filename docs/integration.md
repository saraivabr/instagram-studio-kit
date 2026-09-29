# Integração no produto anfitrião

## Contrato de criação

`createStudio({ ai, repository, assets }).create(tenantId, input, company?, logo?)` valida a entrada e salva uma intenção antes da chamada de IA. `tenantId` deve vir da sessão ou token autenticado, nunca do body. A camada anfitriã aplica permissões, limites, orçamento e auditoria.

`StudioRepository.claim` deve fazer INSERT atômico com unicidade `(tenant_id,id)` e retornar `{created:false,item}` em conflito. Nunca implemente como SELECT seguido de INSERT sem proteção. Os dados devolvidos devem ser cópias ou valores imutáveis. `complete` filtra tenant e ID e lança erro se o registro não existir. `examples/memory.mjs` demonstra o contrato, mas perde dados no restart e não atende múltiplas instâncias. Em produção use Postgres ou equivalente, com RLS e apenas acesso autorizado no backend.

`AssetStore.save` recebe bytes PNG e deve salvar de forma privada em uma chave determinada pela organização e UUID. Gere URLs temporárias no backend para exibir/baixar. O SDK não implementa exclusão, limpeza de órfãos, assinatura ou política de retenção. Falha entre salvar imagem e finalizar registro exige reconciliação no anfitrião.

O mesmo UUID retorna o item existente, mesmo quando o payload enviado depois muda. Use um novo UUID somente para uma criação realmente nova; pedidos `generating` ou `failed` precisam de inspeção. O SDK não repete uma chamada paga após falha ambígua. Se o banco ficar indisponível ao salvar o erro, a intenção pode ficar `generating`: implemente recuperação de pedidos interrompidos sem reenvio cego.

Logo deve vir do storage da organização autenticada. O SDK valida tipo, assinatura PNG/JPEG e limite de 5 MB no fluxo `createStudio`; a associação do arquivo à organização é responsabilidade do anfitrião. As funções de baixo nível retornadas por `createAi` devem receber entradas previamente validadas. Nunca confie em nomes, cores, brief ou pesquisa como instruções privilegiadas.

## Carrossel

Gere um UUID de grupo e oito UUIDs de itens antes de iniciar. Envie sequencialmente oito entradas `kind:'post'`, `format:'feed'` e `carousel:{id:grupo,template:'noticia_impacto_operacional',slide:1..8}`. Preserve esses UUIDs quando retomar. Interrompa ao encontrar falha e exiba os slides concluídos. `carouselTemplates` contém o roteiro e `carouselSlideBrief` cria a direção de cada slide.

As chamadas de imagem são independentes: orientações iguais não garantem consistência visual perfeita. Mostre cada slide para revisão humana antes de publicar. A referência inspira a narrativa e não licencia copiar fotos, marcas ou textos do autor.

## Publicação

1. Autentique e autorize; resolva chave/perfil pelo tenant.
2. Valide com `publicationInput`, carregue os itens por tenant e confira que estão prontos.
3. Use `instagramContext` e `requireInstagramAccount` para verificar conta ativa do perfil.
4. Prepare mídia suportada pelo provedor (o CRM original converte para JPEG) e URLs HTTPS temporárias. O SDK não faz essa conversão.
5. Persista uma intenção de publicação por `(tenant,id)` antes de chamar `publishInstagram(key,input,urls)`. Uma operação já `sending`, `pending` ou `uncertain` deve ser consultada/reconciliada, nunca reenviada automaticamente.
6. Salve recibo e estado. Use `readInstagramPublication` se conhece o ID ou `findInstagramPublication` pelo UUID da intenção após timeout.

`publishInstagram` é um adapter de baixo nível e realiza envio imediato; não oferece sozinho persistência, autenticação ou autorização. UUID em headers/metadata ajuda a correlacionar, mas não substitui seu bloqueio atômico. `findInstagramPublication` verifica apenas os 100 registros retornados: não encontrar não prova ausência. Só o recibo da conta alvo com `published` confirma publicação. Um resultado `pending` permanece pendente. Não faça teste real sem ação autorizada.

## Comentários e Direct

`mutateAutomation(context,input)` valida `automationMutation`, verifica conta, postagem e regra pertencentes ao perfil. A criação envia regra ao executor Zernio; o SDK não executa Direct localmente. Ativar a regra pode enviar mensagens a terceiros. O anfitrião exige manager/admin, autorização explícita e auditoria.

Para logs, primeiro liste `instagramAutomations(context)` e verifique que o ID pertence à organização, depois consulte `comment-automations/{id}/logs?limit=50` com `socialRequest` e valide com `automationLogSchema`. Não transforme mensagens enviadas em leitura, lead ou venda sem evidência. OAuth e permissões variam conforme o plano/provedor e não são configurados neste pacote.

## Aplicativo com a interface original

`apps/studio/` é executável: mantém JSX, componentes UI, CSS, animação e navegação originais. Usa React Query e os mesmos tokens Sage, Manrope e IBM Plex Mono. O adaptador de idioma retorna português; autenticação local é uma identidade fixa explicitamente documentada, não autenticação de produção. O backend salva JSON e PNG em `.studio-data/` (ignorada pelo Git), com fila de escrita e rename atômico para uma única instância. Não é storage distribuído ou banco multi-tenant.

Sem credenciais, a geração cria artes rotuladas como simulação. Com `apps/studio/.env.local`, chave e dois modelos compatíveis, o backend usa `openAiTransport`; chamadas têm custo no provedor. Nunca coloque a chave em `NEXT_PUBLIC_*`. Pesquisa real requer credencial; no modo demo ela falha explicitamente. As telas sociais mostram conta desconectada e bloqueiam publicação/ativação, até você implementar os adapters e autorização.

`app/api/[...path]/route.ts` atende o mesmo contrato de UI; `lib/local/backend.ts` conecta os casos de uso do SDK. Substitua a camada local por banco, storage e sessão do seu produto. `hooks/auth/AuthProvider.tsx` e `lib/auth/server.ts` precisam ser substituídos juntos. Scripts bindam em 127.0.0.1 e a API verifica Host/Origin; não publique esse exemplo sem substituir sua autenticação.

A casca global do CRM, seu kanban e cobrança ficam fora do módulo. Os links de integração têm destinos locais explicativos. O layout interno de Instagram permanece o original.

## Referência da implementação anterior

`reference/nextjs/` preserva criação, animação, biblioteca, revisão, inspirações, publicação, insights e growth como material de adaptação. Fora da compilação do SDK. O inventário completo de imports externos está em `reference-imports.json`.

Substitua os seguintes contratos:

| Dependência original             | Seu produto fornece                                  |
| -------------------------------- | ---------------------------------------------------- |
| `@/lib/auth/*`, guards e suporte | Sessão, tenant confiável, RBAC e proteção de escrita |
| Supabase e request-pool          | Repositório durável, RLS e URLs privadas             |
| Billing/allowance/rate-limit     | Quotas, orçamento e medição de consumo               |
| Branding/i18n/design/components  | Identidade, textos, tokens e componentes             |
| API wrappers/audit/logger        | Erros sanitizados e auditoria                        |
| Social store/client              | Credenciais cifradas e perfil exclusivo por tenant   |

As migrations originais não são distribuídas como instalador autônomo: dependem das tabelas e helpers do CRM. Implemente o schema conforme os contratos acima ou adapte a camada original ao seu banco. Não copie a árvore `reference/` esperando que imports `@/` resolvam automaticamente.
