# Contribuir

Use Node.js 22+, execute `npm ci` na raiz e trabalhe no workspace correspondente. Evite novos lockfiles e cópias de contratos do núcleo na interface.

- `packages/core`: schemas, casos de uso e providers. Preserve os exports públicos.
- `apps/studio/features`: componentes da interface original; mantenha as rotas leves.
- `apps/studio/server`: composição, HTTP e adapters de infraestrutura.
- `tests`: comportamento do núcleo e integração HTTP.

Antes de enviar uma alteração, execute `npm run verify` e `npm run pack:core`. Para mudanças de interface, confira a tela em `npm run dev`. Preserve `LICENSE` e `NOTICE`; nunca inclua `.env.local`, `.studio-data` ou credenciais.
