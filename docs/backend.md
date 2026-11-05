# Backend

A API usa Fastify 5, TypeScript e PostgreSQL 16 pelo driver `pg`, sem ORM. Esta etapa troca a tecnologia e preserva o esquema e o contrato HTTP. A revisão do modelo de dados será uma etapa posterior.

## Organização

- `apps/api/src/app.ts`: composição explícita das dependências, rotas de contratos/atas, validações HTTP, erros, healthcheck e fechamento do pool.
- `apps/api/src/catalog/controller.ts`: registro das rotas do catálogo no Fastify.
- `apps/api/src/service.ts` e `catalog/`: regras de negócio, importação, cache e preparação de documentos.
- `apps/api/src/repositories/`: consultas SQL e operações de persistência específicas de cada área. Serviços recebem repositórios, sem importar o driver nem tipos gerados.
- `apps/api/src/database.ts`: pool de conexões, transações na mesma conexão, decimais como strings e timestamps em UTC.
- `apps/api/src/models.ts`: tipos próprios para as linhas persistidas.
- `apps/api/migrations/`: SQL versionado, executado por `src/migrate.ts`.
- `apps/api/scripts/`: seed opcional e reparo dos identificadores de demonstração.

Valores de entrada usam parâmetros `$1`, `$2`, etc. Identificadores variáveis vêm de listas internas de colunas permitidas. Os auxiliares de escrita apenas montam INSERT/UPDATE; não mapeiam relações nem interpretam expressões de um ORM. Filtros, agregações, junções e conflitos estão explícitos nos repositórios.

Cada criação gera UUID na aplicação. Contratos e atas mantêm `updatedAt` explicitamente. Substituir itens e gravar o cabeçalho ocorre em uma única transação, sem alterar o histórico de exportações. A preparação de documento por fornecedor e a importação de contratos usam isolamento serializável. Atualizações independentes do JSON do pregão usam concatenação no PostgreSQL, preservando as outras partes do snapshot.

## Migrações e instalações existentes

`pnpm db:migrate` aplica os arquivos SQL em ordem, com transação e lock consultivo para serializar inicializações concorrentes. O journal `_sql_migrations` registra nome, checksum SHA-256 e data.

As duas migrações originais mantêm os mesmos nomes e bytes. Em um banco existente, o executor consulta `_prisma_migrations`, verifica o checksum de cada migração concluída e registra sua adoção sem executar novamente o DDL. O journal antigo é preservado. Migrações alteradas, desconhecidas ou anteriores incompletas interrompem a operação com erro explícito. Migrações novas devem ser arquivos novos; nunca edite SQL já aplicado.

The two additional deployed ORM migrations (`202610310002_authentication` and
`202610310003_institution_organization`) are also retained byte-for-byte from
commit `87daef7`, with SHA-256 matching the deployed journal. They preserve legacy
tables and upgrade compatibility; they do not add authentication routes to the
current API. Their historical enum labels remain unchanged to preserve checksums.
The migration adoption test covers all four deployed ORM entries.

Não é necessário recriar o banco, executar seed ou remover volumes para atualizar uma instalação. O Compose continua executando as migrações antes de iniciar a API. Faça backup antes de atualizar um ambiente com dados importantes. Como esta etapa preserva o esquema, a versão anterior da API permanece compatível com os dados; o journal novo não interfere no Prisma antigo.

## Verificação

`pnpm test` executa validações compartilhadas, testes unitários da API, testes HTTP com `Fastify.inject` e regressões do código compilado. `pnpm --filter @contracts/api test:integration` exige PostgreSQL e verifica CRUD, catálogos, transações, concorrência e a transição de migrações.

Para usar um banco separado, exporte `DATABASE_URL` com a conexão de teste antes de `db:migrate` e `test:integration`. Para navegador, inicie API e web com esse mesmo banco e configure também `E2E_DATABASE_URL`.

## Financial database foundation

The financial module adds the `finance` schema through a new SQL migration, without
altering existing contract/catalog tables. Its complete model, ownership boundary,
ETL load contract and relationship diagram are documented in
[Financial data model](finance-data-model.md). The independent
[Go ETL](../apps/etl/README.md) imports daily documents, monthly execution and annual
budget ZIP files into this schema, using separate dataset types and import scopes.
Automatic downloads use `finance.download_state`, added by migration
`202611050002_financial_download_control`, to share request spacing and cooldowns
across worker processes. Local-file mode still requires only the foundation schema.
Fastify now exposes the first read-only financial slice through
`src/finance/`: validated filters, explicit SQL repositories and paginated
commitments with their related documents. See [Financial read API](finance-api-contract.md).
The separate `src/finance/reports.ts` repository provides monthly execution by
unit/classification without mixing daily facts. See [Financial reports](finance-reports-contract.md).
Internal budget distribution endpoints and annual budget reports are future work.

Persistence and financial migration tests now create temporary databases instead
of temporary schemas. A fixed schema name such as `finance` cannot be isolated by
`search_path`. The test role needs `CREATEDB`; each test removes only the database
it created. Existing HTTP integration tests still use the configured application
database and clean up their own records.
