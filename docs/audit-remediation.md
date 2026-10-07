# Correções da auditoria · 0.2.0

Referência: Auditoria Instagram Studio Kit, de 06/10/2026, sobre o commit `4e64b43`.

| Achado | Correção                                                                                                                                            |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| A-01   | Tailwind inclui `features`; E2E verifica grid, espaçamento, cards, tipografia e mobile.                                                             |
| A-02   | Erros HTTP distintos, campos inválidos e request ID; logs estruturados sem body ou credencial.                                                      |
| A-03   | Tamanhos compatíveis por padrão, overrides validados e recorte para a proporção final no storage.                                                   |
| A-04   | SQLite indexado, consulta direta, paginação por cursor, filtros e miniaturas WebP.                                                                  |
| A-05   | Intenção, quota e jobs persistidos em uma transação; HTTP 202, fila serial e carrossel enviado uma vez.                                             |
| A-06   | API resolve sessão, organização e marca; usa portas explícitas de leitura, edição e arquivamento.                                                   |
| A-07   | Falhas permitem nova tentativa com novo UUID e aviso de custo; pedidos podem ser arquivados. Jobs interrompidos não são reenviados automaticamente. |
| A-08   | UUIDs são normalizados; arquivos legados com letras maiúsculas continuam acessíveis.                                                                |
| A-09   | Permalink inválido vira `null`, preservando a publicação confirmada pela conta.                                                                     |
| A-10   | Host é validado dentro do tratamento de erros.                                                                                                      |
| A-11   | Configuração é normalizada e validada sem impedir a leitura do histórico; estado demo/configurada/incompleta.                                       |
| A-12   | Testes usam storage temporário e provedores simulados; contratos sociais e estilos têm cobertura.                                                   |
| A-13   | SVG usa texto e linhas, mostra o briefing e distingue os oito slides; avisos ficam na área segura.                                                  |
| A-14   | Contexto informado na criação é persistido por organização.                                                                                         |
| A-15   | Pesquisa no demo informa explicitamente a configuração necessária; falhas recarregam a lista.                                                       |
| A-16   | Dependência local explícita; distribuição por tarball documentada, sem presumir publicação no npm.                                                  |
| A-17   | Lock atualizado para `source-map-js@1.2.2`; auditoria de dependências e Dependabot no CI.                                                           |
| A-18   | IDs e caminhos dos adapters Zernio validados antes de enviar credenciais.                                                                           |
| A-19   | Espaços, traduções, semântica, título e navegação local corrigidos.                                                                                 |
| A-20   | Métricas usam o contrato do SDK; removidos leads fictícios e sugestões que inventavam provas ou ofertas.                                            |
| A-21   | Rotas exatas, allowlist de métodos, edição somente de post pronto e página inexistente com 404.                                                     |
| A-22   | Tipos gerados fora do Git, env único do app, ESLint e Prettier no CI e comentários revisados.                                                       |
| A-23   | Fontes locais licenciadas, layout sem renderização dinâmica global, thumbnails e favicon.                                                           |
| A-24   | Cabeçalhos de segurança; SQLite WAL/synchronous FULL, arquivos sincronizados e backup da migração JSON.                                             |

A autenticação padrão continua sendo um adapter de demonstração restrito a loopback. Hospedagem exige substituí-lo pela sessão e pelas permissões do produto. SQLite e o worker integrado atendem uma instalação local persistente; um produto com várias instâncias deve fornecer banco, fila e storage compartilhados conforme os contratos.

Os testes não consomem créditos nem publicam conteúdo. Modelos efetivamente habilitados na conta, OAuth, disponibilidade do provedor e entrega real de publicação/Direct precisam de validação na integração do produto. O orçamento em dólares reserva uma estimativa fornecida pelo operador, sem representar a cobrança real do provedor.

## Complemento A-02 · 07/10/2026

A reauditoria de `04f0c68` confirmou 23 achados e identificou a causa dos erros 500 e a repetição do worker como pendências. Os logs agora incluem `error.name`, `error.message`, `error.stack` e a cadeia `error.cause`, associados ao request ID ou job. O cliente continua recebendo apenas a mensagem pública e seu ID.

Erros de JSON armazenado identificam o arquivo/registro e, quando disponível, a posição inválida, sem ecoar conteúdo privado. Headers, credenciais configuradas e padrões de tokens são sanitizados; objetos anexados ao erro não são serializados.

O worker aplica esperas de 5, 10, 20, 40 e até 60 segundos após falhas de infraestrutura. Falhas iguais são registradas no máximo uma vez por minuto; uma causa diferente produz novo diagnóstico. Quando o armazenamento volta a funcionar, o worker retoma e reinicia seu controle de espera. Isso não reenvia um job pago de resultado incerto.

A verificação inclui testes de sanitização e controle de repetição, além de um servidor Next real com JSON corrompido em pasta temporária: correlação do 500, diagnóstico da migração, janela de 30 segundos, preservação do arquivo e retomada depois de repará-lo sem reiniciar o processo.
