# Atualização automática dos detalhes públicos

Solicitação: abrir atas públicas com detalhes, participantes e saldos atualizados para todos os itens, e aplicar a mesma experiência aos demais detalhes públicos.

## Comportamento

Exibir primeiro o cache PostgreSQL. Ao abrir pregão, consultar automaticamente detalhes e atas vinculadas quando SRP confirmado. Ao abrir ata pública, atualizar cabeçalho/itens e consultar em lote unidades, empenhos/saldos e adesões. Preparação de documento consulta automaticamente os metadados públicos antes de selecionar fornecedor. Os documentos e cadastros locais mantêm os dados salvos pelo usuário.

Usar cache de cinco minutos, deduplicação de requisições em andamento e intervalo curto após falhas; botão manual permite forçar atualização. GETs continuam locais, mas a interface passa a acionar automaticamente os POSTs de atualização. Falhas preservam o cache e aparecem por etapa, sem estados vazios falsos.

A consulta em lote deduplica itens numericamente equivalentes e consulta empenhos apenas uma vez por ata. Limitar chamadas concorrentes ao governo. Propagar os resultados aos painéis de todos os fornecedores do mesmo item, sem estado local desatualizado.

## Tarefas

- [x] Backend: coordenação automática, cache/deduplicação, consulta em lote e limites de concorrência.
- [x] Testes unitários e PostgreSQL/HTTP das etapas, falhas parciais e reaproveitamento de chamadas.
- [ ] Frontend: atualização automática progressiva em pregões, atas e preparação; indicadores, repetição e painéis sincronizados.
- [ ] Testes de navegador, regressões, build/lint e revisão independente.
- [ ] Verificar a ata informada em Docker, atualizar documentação e GitHub.
