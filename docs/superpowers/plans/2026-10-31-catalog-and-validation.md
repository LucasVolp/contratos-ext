# Pregões, atas públicas e formulários Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Implement sequentially with independent spec review followed by quality review; no further user confirmation is needed for approved scope.

**Goal:** Ampliar a base aprovada com catálogos públicos persistidos de pregões/atas e validações/máscaras consistentes em todos os formulários.

**Architecture:** Manter Next/Nest/PostgreSQL/Gotenberg. Adicionar pacote puro de validação compartilhado, dois modelos de catálogo com identidade pública e snapshots, e páginas de consulta independentes do arquivo de documentos. Campos e snapshots locais editados não são sobrescritos por atualização pública.

**Tech Stack:** Stack existente, pnpm workspace com packages/validation; validadores determinísticos sem dependência remota; integração Compras.gov com transportes simuláveis.

## 1. Validação e máscaras
- [ ] Criar packages/validation com CPF/CNPJ numérico/alfanumérico, UASG, UF, calendário e decimais; testar casos válidos, DV incorreto, repetidos, colagem e precisão.
- [ ] Aplicar regras em domain/importRange e retornar fieldErrors por campo na API; preservar rascunho opcional e manter readiness de documentos antigos coerente.
- [ ] Aplicar máscaras no Field/editor/importação/filtros, mensagens inline e foco/resumo no envio; evitar mascarar e truncar formatos livres e evitar perda de centavos.
- [ ] Atualizar fixtures fictícias inválidas para documentos de teste válidos; seed preserva registros e histórico existentes. Conferir lint/build/testes.

## 2. Catálogos backend
- [ ] Adicionar PublicPurchase/PublicRecord e origem de documento por fornecedor em migration nova, sem alterar migration aplicada.
- [ ] Implementar páginas de listagem SQL, filtros e atualização pública explícita; identidade externa única e estado de carregamento de detalhe persistido.
- [ ] Detalhe pregão por idCompra, todos itens/resultados, cancelamentos e SRP tri-state. Testar ausência, múltiplos resultados e independência de UASG/ano.
- [ ] Detalhe ata por controle PNCP; consulta lazy de unidades, empenhos/saldos e adesões por item com estados de ausência/erro separados.
- [ ] Vincular por identificador público exato, considerando exercício seguinte para vigência; não usar filtro de compra inexistente na API pública.
- [ ] Preparar documento por fornecedor selecionado, preencher metadados disponíveis, nunca inventar número oficial, reutilizar rascunho por origem/fornecedor sem sobrescrever dados locais.
- [ ] Testes RED→GREEN, PostgreSQL HTTP integration, migração e build CommonJS real.

## 3. Interface catálogos
- [ ] Navegação Contratos/Pregões/Atas & documentos com máscara/filtros também nos novos campos.
- [ ] Pregões listagem+consulta e detalhe com itens/resultados/fornecedores e atas vinculadas.
- [ ] Atas públicas em visão própria, detalhes, itens e informações auxiliares lazy, ação de preparar documento com seleção explícita de fornecedor.
- [ ] Exibir data/origem e manter consultas locais em indisponibilidade; mensagens úteis sem transformar erro em vazio.
- [ ] Responsividade, foco visível, rótulos e recuperação de falhas; build/lint e revisão independente.

## 4. Integração e entrega
- [ ] Atualizar Docker para pacote compartilhado, migrations e README.
- [ ] Subir stack e verificar consultas reais com uma UASG pública; fixtures automatizadas sem depender do governo.
- [ ] E2E de máscaras/erros/bloqueio de envio, catálogo persistido, vínculos, múltiplos fornecedores e documento completo.
- [ ] Inspecionar desktop/móvel e downloads DOCX/PDF reais; preservar regressões existentes.
- [ ] Executar testes, builds e lint, registrar evidência, commit da ampliação sem publicar externamente.
