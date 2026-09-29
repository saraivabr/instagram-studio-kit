# Mudanças

## 0.1.1

- Workspace npm com uma instalação e um lockfile para aplicativo e SDK.
- Núcleo em `packages/core`, separado em domínio, aplicação e provedores; API pública preservada, com imports por área.
- Telas originais em `apps/studio/features/instagram`; rotas leves, sem alteração do layout.
- HTTP, composição, persistência, imagens e simulação em módulos separados.
- Contratos duplicados removidos da interface; referência antiga isolada em `docs/legacy`.
- Verificação HTTP inicia e encerra seu servidor automaticamente.

Migração: substitua instalações com `file:/caminho/do/repositorio` por `file:/caminho/do/repositorio/packages/core` ou use o arquivo gerado por `npm run pack:core`. Execute `npm ci` somente na raiz; não há mais instalação separada do aplicativo. Para executar o exemplo, use `npm run dev`.
