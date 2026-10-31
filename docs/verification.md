# Verificação da aplicação independente

Verificado em 31/10/2026. Branch: `feat/public-catalog-and-validation`.

## Resultado final

- Imagens Docker de API e web construídas; PostgreSQL, API e web saudáveis, Gotenberg ativo.
- `pnpm test`: 9 testes de validação compartilhada, 53 unitários da API e 2 regressões executando o CommonJS compilado, todos passando.
- `pnpm --filter @contracts/api test:integration`: 2 integrações HTTP com PostgreSQL, passando.
- `pnpm test:e2e`: 21 fluxos passando contra os containers de produção.
- `pnpm lint`: ESLint e TypeScript do frontend e TypeScript da API, passando.
- Build de produção do frontend e build compilado da API passando.
- `docker compose config --quiet` e verificação de whitespace das alterações finais sem erros. A migration gerada pelo Prisma foi preservada após aplicação, incluindo sua linha final vazia.

Total: **87 testes automatizados aprovados**.

## Ampliação verificada

Pregões e atas publicadas possuem catálogos próprios no PostgreSQL, filtros/paginação SQL, detalhes e datas de consulta. GETs consultam a base local; a fonte pública é acionada explicitamente. Falhas externas preservam os dados salvos.

Vínculos usam IDs completos da compra ou controle PNCP, com prioridade para `idCompra`; um ID contraditório não é substituído por coincidência no PNCP ou número. A busca de atas vinculadas considera vigência no exercício seguinte e paginação completa sem inventar filtro público por compra. SRP falso/desconhecido é distinto de SRP confirmado.

Todos os resultados por item são preservados, inclusive cancelados. Evidências de cancelamento usam item PNCP e documento normalizado do fornecedor; o estado confirmado mais recente prevalece entre os snapshots locais. Falha no enriquecimento não apaga essa evidência. A criação de um novo rascunho também confere resultados mais recentes já salvos no catálogo de compras. Números de itens `00001` e `1` correspondem numericamente sem modificar os IDs opacos, a apresentação ou os parâmetros enviados à fonte.

Participantes, empenhos/saldos e adesões são consultas auxiliares independentes, com estado carregado/não consultado/erro, cache anterior e data da última consulta bem sucedida. Empenhos são filtrados pelo item depois da consulta por ata. O escopo público é informado como item/ata quando não distingue fornecedor.

A preparação exige seleção de fornecedor. Dois fornecedores podem originar documentos distintos com o mesmo número oficial. Repetir origem+fornecedor abre o documento existente e preserva dados manuais e histórico. Exportação real DOCX/PDF continua funcionando.

## Formulários e apresentação

CPF, CNPJ numérico/alfanumérico, UASG com zeros iniciais, UF, calendário/intervalos e decimais são validados também no backend. Máscaras mantêm o valor canônico; números institucionais livres não recebem uma máscara indevida. Erros têm mensagens inline, resumo, associação acessível e foco no primeiro campo inválido. O primeiro clique de envio funciona mesmo quando a saída do campo revela novos erros, sem deslocar o botão entre o início e o fim do clique.

Valores de entrada mantêm até 6 casas decimais sem arredondamento ou conversão por Number. Totais calculados podem ter maior precisão e continuam formatados em português sem perda de casas. A seleção de um valor monetário já preenchido permanece estável durante a edição.

Os testes preservam CRUD, prontidão, documentos e recuperação de falhas da base anterior. As regressões de produção carregam `dist/documents` com Node, cobrindo o antigo shadowing de `exports` que não aparecia no transpiler de desenvolvimento.

## Integrações reais e inspeção visual

- Compras.gov, UASG 158148: período de novembro/2025 salvou 5 pregões. Consulta de um único dia, 18/11/2025, retornou os 4 registros publicados nesse dia, incluindo horários posteriores à meia-noite.
- Pregão 90209/2025: 26 itens e 26 resultados. Ata 00001/2026: 26 itens, um fornecedor e vínculo exato com a compra; unidades de medida preenchidas pela correspondência numérica do item PNCP.
- Consulta auxiliar do item público `00001`: participantes e adesões carregados; empenhos com ausência confirmada. Dados e timestamps foram persistidos.
- Reinício do PostgreSQL: contagens e hashes idênticos em Contract, PriceRecord, RecordItem, PublicPurchase, PublicRecord e CatalogSupplement. Foram preservados os cadastros existentes, incluindo um documento manual legado, além da demonstração e dos catálogos públicos.
- Desktop 1440px e celular 390px inspecionados. Navegação com três áreas visíveis; tabelas com rolagem interna. Ata real com descrições longas separadas por barras mantém scrollWidth 390px em viewport 390px. A mesma descrição está na regressão móvel automatizada.
- Modelo Word v2 preservado: a inspeção anterior de suas 7 páginas permanece válida; esta ampliação não altera estrutura ou cláusulas. A geração DOCX/PDF real e o histórico passaram novamente nos fluxos ponta a ponta.

Os testes de integração pública usam transportes simulados; não dependem do governo. As consultas reais acima foram verificações separadas. As fixtures de navegador são isoladas e removidas ao final. Permaneceram no catálogo local os dados públicos reais consultados, disponíveis para revisão na interface.
