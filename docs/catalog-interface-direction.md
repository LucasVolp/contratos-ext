# Catálogos públicos — interface

Manter a identidade editorial da base aprovada: Fraunces/DM Sans locais, marfim/verde/terracota, tabelas com bom ritmo e formulários em páginas próprias. Não copiar shell/cards/modais de referência.

Navegação principal: Contratos (01), Pregões (02), Atas & documentos (03). Em celular, três links visíveis que cabem ou se distribuem em linhas sem ampliar viewport; não ocultar ações essenciais. PageHead diferencia as três áreas.

Rotas:
- `/pregoes`: lista local, busca acessível `Buscar pregões`, filtros UASG e publicação, data de consulta e ação `Consultar pregões` para página `/pregoes/consultar`.
- `/pregoes/[id]`: processo/objeto/organização, SRP verdadeiro/falso/desconhecido, datas e valores; `Atualizar detalhes` explícito; itens e resultados agrupados sem perder linhas, cancelamentos identificados; seção `Atas vinculadas` com estado não consultado, confirmação vazia ou falha e retry preservando dados anteriores.
- `/atas`: documentos locais atuais. Acrescentar links de visão `Documentos locais` e `Atas publicadas`.
- `/atas/publicadas`: catálogo público persistido, busca `Buscar atas publicadas`, filtros, valor/vigência/compra e ação `Consultar atas` para `/atas/publicadas/consultar`.
- `/atas/publicadas/[id]`: cabeçalho/itens/fornecedores, compra vinculada quando salva localmente, `Atualizar detalhes`, datas de consulta e indicadores de dados indisponíveis. Informações auxiliares por item são consultadas por ação explícita `Consultar participantes e saldos`; exibir participantes, empenhos/saldos e adesões separadamente, com erro/últimos dados salvos/ausência confirmada distintos.
- `/atas/publicadas/[id]/preparar`: seleção obrigatória do fornecedor, identificação da ata oficial e ação `Preparar documento`; abrir `/atas/[draftId]/editar` após criação ou reutilização idempotente. Informar que dados disponíveis serão preenchidos e complementados no editor; não afirmar documento pronto sem validação. Não editar documentos existentes por sincronização.

As consultas públicas usam formulário compartilhado UASG/data inicial/data final, com máscara e validação do pacote validation + erro resumido/inline, foco, aria. Explicar no contexto quando período significa publicação da compra ou início da vigência da ata. Atualizar snapshot é ação do usuário; nenhuma busca externa automática em GET ou no carregamento silencioso da página.

Metadados e campos nulos são mostrados como `Não informado`/`Não consultado`, nunca como zero ou “não há” até consulta bem sucedida. Toda falha possui nova tentativa e preserva consulta anterior. Valores são strings exatas, formatados pelo pacote compartilhado. Cada linha tem link real de detalhe; paginação SQL. Tabelas com scroll interno e ancestral posicionado para labels sr-only, conservando correção móvel anterior.

Componentes recomendados: `components/catalog/catalog-list.tsx`, `catalog-sync.tsx`, `purchase-detail.tsx`, `public-record-detail.tsx`, `prepare-document.tsx`, `catalog-tabs.tsx`, `lib/catalog-api.ts`. Dividir detalhes/linhas auxiliares quando necessário; evitar um arquivo gigante para os dois domínios. As páginas só montam componentes e aguardam params Promise conforme Next16.4.
