# Contracts Ext

Aplicação independente para acompanhar contratos, consultar pregões e atas públicas e preencher documentos de atas de registro de preços em modelos Word, com download em DOCX e PDF. The interface is in Portuguese, with session authentication and institution-scoped access.

## Iniciar com Docker

Requisitos: Docker com Compose.

```sh
cp .env.example .env
docker compose up --build -d
```

Abra **http://localhost:3100**. A migração do banco roda automaticamente antes de iniciar a API. Não é necessário ter SAGA ou DIRAD instalados.

O banco inicia vazio. Para carregar exemplos identificados como demonstração:

```sh
docker compose exec api pnpm db:seed
```

O seed é opcional e idempotente; não substitui exemplos já editados nem seu histórico. Os dados importados e cadastrados ficam no volume `postgres_data`, que é preservado por `docker compose down`. Não use `down -v` se quiser preservar os registros.

## Usar

**Contratos:** somente consulta. Os contratos das UASGs cadastradas em instituições chegam sozinhos, pela réplica diária do Contratos.gov.br: não há importação nem cadastro manual. Consulte fornecedor, objeto, valores e vigência; pesquise e filtre a listagem, que informa a data da última atualização. O detalhe mostra histórico, garantias, responsáveis, itens, faturas e arquivos. A única informação gravada pela aplicação são as **observações internas** de cada contrato, que não são alteradas pelas atualizações diárias. Para carregar os contratos pela primeira vez, veja [Sincronização diária de contratos](#sincronização-diária-de-contratos).

**Pregões:** consulte por UASG e período de publicação. A consulta salva os dados no banco local. Ao abrir o pregão, os detalhes e as atas vinculadas com SRP confirmado são atualizados automaticamente. Examine os itens com paginação e busca por número, descrição ou fornecedor e identifique cancelamentos. O vínculo usa os identificadores públicos completos da compra. Quando a fonte retorna algumas atas sem controle PNCP, as identificadas continuam disponíveis e a tela informa quais registros vieram incompletos, sem confundir essa situação com ausência de atas.

**Atas publicadas:** consulte por UASG e início da vigência. Ao abrir o detalhe, cabeçalho e itens são atualizados automaticamente, seguidos da consulta em lote de participantes, empenhos/saldos e adesões de todos os itens. Também é possível atualizar todo o lote com uma ação. Cada consulta auxiliar informa separadamente seu resultado, erro e última consulta salva. Os dados auxiliares têm o escopo do item da ata quando a fonte não distingue o fornecedor. Para preparar um documento, selecione um fornecedor: a mesma ata oficial pode originar documentos distintos para cada fornecedor.

**Atas e documentos:** crie uma ata ou importe os dados públicos disponíveis. Preencha organização, autoridade signatária, fornecedor e itens. Salve rascunhos e consulte as pendências antes de exportar. Baixe a ata completa ou um item em DOCX/PDF. O histórico registra cada geração concluída.

Atas existentes não são substituídas por nova importação: use a edição para manter o preenchimento local.

A importação de atas usa somente a API pública Compras.gov.br. Não chama APIs SAGA/DIRAD. Dados indisponíveis externamente devem ser preenchidos no editor. Cada documento corresponde a um fornecedor. No catálogo público, a seleção do fornecedor separa os itens corretamente; repetir a preparação abre o documento existente sem alterar seu preenchimento ou histórico. A importação direta legada recusa respostas com vários fornecedores e orienta usar o catálogo.

Listagens e buscas leem os dados salvos. Ao abrir pregões, atas públicas ou a preparação de documentos, a aplicação mostra o cache e atualiza os dados públicos automaticamente em segundo plano. Consultas recentes são reaproveitadas por cinco minutos; requisições repetidas compartilham o carregamento. Os botões permitem forçar uma atualização. Falhas preservam a última consulta local e identificam as partes indisponíveis. Campos desconhecidos são identificados como não informados.

**Formulários:** CPF/CNPJ (incluindo CNPJ alfanumérico), UASG, UF, datas e valores possuem validação também no backend. Documentos recebem máscara, UASG mantém zeros à esquerda e valores usam formato brasileiro sem perder casas decimais. O envio mostra um resumo das pendências, mensagens junto aos campos e foco no primeiro erro. Números institucionais livres, como processo e ata, conservam seu formato original.

## Arquitetura

The [contract and catalog ER diagram](docs/diagrama-entidade-relacionamento.md)
documents the seven existing public tables. The [financial data model](docs/finance-data-model.md)
documents the fourteen domain tables and shared download-control table in the `finance` schema, the Go ETL ownership
boundary and the import contract. The [public sources data model](docs/public-sources-data-model.md)
documents the Contratos.gov.br replica captured by the Go replicator
(`pnpm sources:sync` for manual runs, `pnpm sources:daily` for the daily cycle). The [Go Finance ETL](apps/etl/README.md) imports
complete ZIPs containing daily commitments, liquidations and payments, monthly
execution and annual budgets. Omit `-file` to download automatically, with shared
request pacing and cooldowns; date ranges are supported. The first
[financial read API](docs/finance-api-contract.md)
provides management units, commitment list/detail and paginated related items,
history, liquidations and payments. [Financial reports](docs/finance-reports-contract.md)
include monthly execution by management unit and expense classification and annual
institutional LOA by agency, action and the classification supplied by the source.
The [financial workspace](docs/finance-pages.md) exposes commitment list/detail,
monthly execution and institutional LOA pages at `/financeiro`, with URL filters
and pagination. Internal planning and the accounts-payable balance remain pending.

| Serviço | Tecnologia | Acesso local padrão |
|---|---|---|
| Web | Next.js 16, React 19, Tailwind 4 | http://localhost:3100 |
| API | Fastify 5, SQL com `pg` | http://localhost:4100 |
| Banco | PostgreSQL 16 | localhost:5540 |
| PDF | Gotenberg 8 / LibreOffice | http://localhost:3055 |

A organização do backend e a transição das migrações estão descritas em [Backend](docs/backend.md).

O frontend encaminha `/api/*` para o backend na rede interna. A API gera DOCX com docxtemplater/PizZip e envia o Word para o Gotenberg somente quando o formato solicitado é PDF. Falha do conversor não impede DOCX. As portas são publicadas apenas em loopback por padrão.

## Desenvolvimento local

Node.js 22 e pnpm 10.32.1.

```sh
pnpm install
cp .env.example .env
docker compose up -d db gotenberg
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Configurações locais em `.env`: `DATABASE_URL`, `GOTENBERG_URL` e `API_INTERNAL_URL`. O Compose usa os endereços internos próprios, sem depender dos hosts de desenvolvimento.

## Verificação

```sh
pnpm test
# Com o banco disponível:
pnpm --filter @contracts/api test:integration
pnpm lint
pnpm build
# Com a aplicação e o Gotenberg rodando:
pnpm exec playwright install chromium
pnpm test:e2e
```

Os testes de importação e de integração com os catálogos usam respostas simuladas, sem depender da disponibilidade de serviços públicos. Os testes de navegador de catálogo criam registros isolados e os removem ao final. Para outro banco local, configure `E2E_DATABASE_URL` (padrão: a conexão local do Compose na porta 5540). A suíte ponta a ponta verifica persistência, edição, validações, DOCX/PDF reais, navegação e apresentação móvel.

## Sincronização diária de contratos

Os contratos vêm do serviço `replicator` (Go, `apps/etl`), que consulta o Contratos.gov.br uma vez por dia para cada UASG cadastrada em `"Institution"` e grava a réplica em `public_sources`. A API e a interface só leem essa réplica; nunca chamam a fonte.

```sh
# Compose: serviço contínuo (perfil opcional `sync`; `docker compose up` não o inicia)
docker compose --profile sync up -d --build replicator

# Desenvolvimento local: um ciclo agora (JSON no stdout; código 1 se não concluir)
pnpm sources:daily -- -source CONTRATOS_GOV_BR -once
```

Cadastre ao menos uma instituição (`pnpm db:seed-institutions` ou a administração) antes do primeiro ciclo. O primeiro ciclo é lento de propósito: cada requisição respeita o intervalo mínimo e as pausas da fonte, então uma UASG com cerca de 240 contratos levou aproximadamente 30 minutos em um teste real (cerca de 1,7 mil requisições), e UASGs maiores levam proporcionalmente mais. A listagem de contratos mostra o estado de carregamento e a data da última atualização. Nos ciclos seguintes, contratos que a fonte marca como inativos e não mudaram são ignorados até 30 dias após a última captura; os ativos são atualizados todos os dias. Detalhes de agenda, política e travas estão em [Go Finance ETL](apps/etl/README.md#daily-mode).

## Modelo Word

O modelo versionado fica em `apps/api/templates`. A formatação vem do arquivo `.docx`; a API substitui os campos e repete a tabela de itens. Para alterar estrutura ou cláusulas, edite o modelo preservando as tags documentadas pelo mapeador. A versão do modelo é salva junto ao histórico de geração. Documentos devem ser revisados pelo responsável antes de uso.

## Operação

```sh
docker compose ps
docker compose logs --tail=100 api web
docker compose restart api
docker compose down
```

Importações de pregões e atas podem demorar de acordo com o período e o serviço público. Em falhas, a interface informa o erro; a base local permanece consultável. Use o período em que a vigência dos registros importados se iniciou, conforme o filtro da API pública.

Para mudar portas, altere `WEB_PORT`, `API_PORT`, `POSTGRES_PORT` e `GOTENBERG_PORT` no `.env`. As credenciais padrão são exclusivamente para desenvolvimento local; configure `POSTGRES_USER`, `POSTGRES_PASSWORD` e `POSTGRES_DB` conforme seu ambiente.

O escopo não inclui usuários, permissões, assinaturas eletrônicas, fiscalização, aditivos ou tramitação de processos. Não publique a aplicação na internet sem adicionar os controles adequados ao ambiente.

## Authentication setup

Set private `ADMIN_EMAIL` and `ADMIN_PASSWORD` values in `.env` before starting the
API. Startup creates the initial general manager only when no accounts exist.
`pnpm auth:create-manager` explicitly creates or restores a manager using these
values. `pnpm db:seed-institutions` optionally registers the known MS institutions
without replacing existing names or links. No default password is created.

Sessions use HttpOnly, SameSite=Lax cookies. Set `SESSION_COOKIE_SECURE=true` for
HTTPS and `SESSION_TTL_HOURS` to change the default 12-hour lifetime. Institution
restrictions are enforced by SQL repositories, including financial reads; client
filters only narrow the viewer's scope. Administration and institutional LOA are
restricted to general managers.
