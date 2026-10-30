# Contracts Ext Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Execute tasks with spec review followed by code-quality review; keep changes in this fresh dedicated repository on feat/standalone-modules.

**Goal:** Entregar aplicação independente de contratos e atas com persistência PostgreSQL, importação pública e documentos Word/PDF.

**Architecture:** Monorepo pnpm, Next.js no frontend, NestJS com Prisma 7 na API, PostgreSQL e Gotenberg. Adaptadores de importação não dependem de serviços dos sistemas de referência. Interface usa mesma origem com proxy Next.js.

**Tech Stack:** Node 22, Next 16, React 19, Tailwind 4, NestJS 11, Prisma 7, docxtemplater, PizZip, Docker Compose, PostgreSQL 16, Gotenberg 8.

## Task 1: Fundação e contrato de integração
- [x] Explorar diretório, ferramentas e implementação de referência.
- [x] Registrar interfaces e endpoints completos em docs/api-contract.md.
- [x] Inicializar repositório independente e workspace pnpm.
- [ ] Configurar Compose com health checks, volume e migração inicial; build independente de API/web.

## Task 2: API e domínio
Files: apps/api/package.json, prisma/schema.prisma, prisma/migrations, src/main.ts, src/app.module.ts, src/database, src/contracts, src/records, src/documents, src/imports, test.
- [ ] Escrever testes de vigência com relógio fixo: expires today, +30 e +31 dias, datas ausentes, future start; teste rejeita intervalo invertido.
- [ ] Rodar pnpm --filter @contracts/api test e observar falha pela regra ainda ausente.
- [ ] Implementar regras isoladas e cálculo decimal (0.10 * 3 = 0.30) e repetir testes.
- [ ] Implementar schema, migração e CRUD de contratos/atas conforme docs/api-contract.md, com substituição transacional de itens.
- [ ] Testar importação com transporte simulado: múltiplas páginas, deduplicação e falha antes de persistir.
- [ ] Adaptar modelo DOCX de referência sem identidade SAGA/DIRAD e testar render com várias linhas sem tags residuais.
- [ ] Implementar readiness e exportações com snapshot; timeouts e falha PDF não bloqueiam DOCX.
- [ ] Implementar seed idempotente opcional com registros claramente demonstrativos.
- [ ] Executar testes, tsc e revisar conformidade e qualidade.

## Task 3: Interface independente
Files: apps/web/app, components, lib, public/fonts, package.json, next.config.ts.
- [ ] Implementar sistema visual editorial marfim/verde/terracota, tipografia Fraunces e sans de leitura auto-hospedadas; navegação somente dois módulos.
- [ ] Integrar contrato da API: listagens, filtros, indicadores, detalhes e formulários de contratos.
- [ ] Implementar editor de atas com seções, itens dinâmicos, total e painel de preparação/exportação; histórico de exportações.
- [ ] Importações por páginas próprias; erros recuperáveis, confirmações de exclusão e estados vazios reais.
- [ ] Verificar build, lint e navegação desktop/móvel; sem mocks/fallback de dados na UI.

## Task 4: Integração e entrega
Files: compose.yaml, Dockerfile(s), README.md, tests/e2e, docs/verification.md.
- [ ] Subir docker compose up --build -d, executar migração e seed explícito para demonstração.
- [ ] Verificar CRUD persistente por HTTP e exportação Word/PDF real usando Gotenberg.
- [ ] Verificar fluxo de preenchimento e download no navegador em desktop e mobile.
- [ ] Reiniciar serviço banco e confirmar registros preservados.
- [ ] Executar pnpm test, pnpm lint e pnpm build; registrar resultados reais e limitações.
- [ ] Revisão final independente de escopo e qualidade, corrigir achados, commit sem publicar ou criar dependência externa.
