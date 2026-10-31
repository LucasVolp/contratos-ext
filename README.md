# Contracts Ext

Aplicação independente para acompanhar contratos, consultar pregões e atas públicas e preencher documentos de atas de registro de preços em modelos Word, com download em DOCX e PDF. Interface em português, sem autenticação.

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

**Contratos:** cadastre um contrato ou importe por UASG e período. Consulte fornecedor, objeto, valores e vigência; pesquise e filtre a listagem. A situação é calculada por data, sem necessidade de atualização manual.

**Pregões:** consulte por UASG e período de publicação. A consulta salva os dados no banco local. Abra o pregão para atualizar detalhes, examinar todos os resultados dos itens, identificar cancelamentos e consultar atas vinculadas quando houver registro de preços (SRP). O vínculo usa os identificadores públicos completos da compra.

**Atas publicadas:** consulte por UASG e início da vigência. No detalhe, atualize os itens e consulte participantes, empenhos/saldos e adesões por item. Cada consulta auxiliar informa separadamente seu resultado, erro e última consulta salva. Os dados auxiliares têm o escopo do item da ata quando a fonte não distingue o fornecedor. Para preparar um documento, selecione um fornecedor: a mesma ata oficial pode originar documentos distintos para cada fornecedor.

**Atas e documentos:** crie uma ata ou importe os dados públicos disponíveis. Preencha organização, autoridade signatária, fornecedor e itens. Salve rascunhos e consulte as pendências antes de exportar. Baixe a ata completa ou um item em DOCX/PDF. O histórico registra cada geração concluída.

Contratos importados anteriormente são atualizados sem duplicação; cadastros manuais com a mesma identidade são preservados e geram conflito explícito. Atas existentes não são substituídas por nova importação: use a edição para manter o preenchimento local.

A importação usa somente a API pública Compras.gov.br. Não chama APIs SAGA/DIRAD. Dados indisponíveis externamente devem ser preenchidos no editor. Cada documento corresponde a um fornecedor. No catálogo público, a seleção do fornecedor separa os itens corretamente; repetir a preparação abre o documento existente sem alterar seu preenchimento ou histórico. A importação direta legada recusa respostas com vários fornecedores e orienta usar o catálogo.

As telas de consulta leem os dados salvos. A atualização no Compras.gov é uma ação explícita; falhas preservam a última consulta local. Campos desconhecidos são identificados como não informados.

**Formulários:** CPF/CNPJ (incluindo CNPJ alfanumérico), UASG, UF, datas e valores possuem validação também no backend. Documentos recebem máscara, UASG mantém zeros à esquerda e valores usam formato brasileiro sem perder casas decimais. O envio mostra um resumo das pendências, mensagens junto aos campos e foco no primeiro erro. Números institucionais livres, como processo e ata, conservam seu formato original.

## Arquitetura

| Serviço | Tecnologia | Acesso local padrão |
|---|---|---|
| Web | Next.js 16, React 19, Tailwind 4 | http://localhost:3100 |
| API | NestJS 11, Prisma 7 | http://localhost:4100 |
| Banco | PostgreSQL 16 | localhost:5540 |
| PDF | Gotenberg 8 / LibreOffice | http://localhost:3055 |

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

## Modelo Word

O modelo versionado fica em `apps/api/templates`. A formatação vem do arquivo `.docx`; a API substitui os campos e repete a tabela de itens. Para alterar estrutura ou cláusulas, edite o modelo preservando as tags documentadas pelo mapeador. A versão do modelo é salva junto ao histórico de geração. Documentos devem ser revisados pelo responsável antes de uso.

## Operação

```sh
docker compose ps
docker compose logs --tail=100 api web
docker compose restart api
docker compose down
```

Importações podem demorar de acordo com o período e o serviço público. Em falhas, a interface informa o erro; a base local permanece consultável. Use o período em que a vigência dos registros importados se iniciou, conforme o filtro da API pública.

Para mudar portas, altere `WEB_PORT`, `API_PORT`, `POSTGRES_PORT` e `GOTENBERG_PORT` no `.env`. As credenciais padrão são exclusivamente para desenvolvimento local; configure `POSTGRES_USER`, `POSTGRES_PASSWORD` e `POSTGRES_DB` conforme seu ambiente.

O escopo não inclui usuários, permissões, assinaturas eletrônicas, fiscalização, aditivos ou tramitação de processos. Não publique a aplicação na internet sem adicionar os controles adequados ao ambiente.
