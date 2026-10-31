# API dos catálogos públicos — ampliação aprovada

Todos endpoints sob `/api`. IDs locais UUID; identificadores externos são strings opacas. Valores monetários/quantidades retornam strings decimais ou null (null não é zero). Datas de negócio YYYY-MM-DD; timestamps ISO. Sem autenticação. Reutilizar validação compartilhada e erros `{message,fieldErrors?}`. GETs leem PostgreSQL, nunca consultam governo silenciosamente. POSTs explícitos atualizam snapshots; falha externa preserva a última consulta local. Não transformar erro ou detalhe ainda não consultado em “nenhum registro”.

## Pregões

- `GET /purchases?search=&uasg=&from=&to=&page=1&limit=12` → `{data:PurchaseSummary[],total,page,limit,stats:{count,srpCount,estimatedValue,awardedValue}}`. Filtro de datas sobre publicação. Estatísticas SQL sobre o filtro inteiro; valores agregam somente dados conhecidos, detalhes podem continuar null.
- `POST /purchases/sync` body `{uasg,from,to}` → `{created,updated,total}`. Consultar Compras.gov modalidade5 por UASG e publicação, percorrer TODAS páginas; validar intervalo <=366 dias. Upsert local somente após coleta bem sucedida; não apagar registros de outras consultas.
- `GET /purchases/:id` → `PurchaseDetail` local.
- `POST /purchases/:id/refresh` → `PurchaseDetail`. Busca direta por idCompra: contratação, itens e resultados. Campos indisponíveis permanecem null. Preservar TODOS resultados de cada item, com identificadores/cancelamentos, sem deduplicar somente pelo item ou fornecedor.
- `POST /purchases/:id/records/refresh` body `{from?,to?}` → `{total,records:PublicRecordSummary[],from,to}`. Somente srp===true permite esta ação; false/unknown retornam422 útil. Padrão de janela: início do ano da compra/publicação até fim do ano seguinte, dividido em janelas oficiais quando necessário. Listagem ARP não tem filtro por compra: filtrar todos resultados por idCompra ou controlePNCP exato. Nunca associar só por número. Persistir snapshots de atas vinculadas. Atualizar status/data dessa consulta para distinguir “não consultado” de lista confirmada vazia.

`PurchaseSummary`: `{id,externalId,number,year,uasg,unitName,object,status,srp:boolean|null,pncpId,processNumber,organizationName,organizationDocument,city,state,estimatedValue:string|null,awardedValue:string|null,publishedAt,openingAt,closingAt,lastSyncedAt,detailsSyncedAt,recordsSyncedAt}`. number conforme fonte, year separado; UI não duplica /ano. `PurchaseDetail` acrescenta `{items:PurchaseItem[],linkedRecords:PublicRecordSummary[]}`.

`PurchaseItem`: `{externalId,number:string,description,unit,quantity:string|null,estimatedUnitPrice:string|null,estimatedTotal:string|null,status,results:PurchaseResult[]}`.
`PurchaseResult`: `{externalId,supplierDocument,supplierName,quantity:string|null,unitPrice:string|null,totalValue:string|null,status,cancelled:boolean,cancelledAt:string|null,resultDate:string|null}`. Usar sequencialResultado + identidade do item para preservar linhas distintas. Vencedor só quando a fonte confirmar; UI pode dizer “Resultado informado” e destacar cancelamento.

## Atas publicadas

- `GET /public-records?search=&uasg=&from=&to=&page=1&limit=12` → `{data:PublicRecordSummary[],total,page,limit,stats:{count,totalValue}}`. Período intersecta vigência quando informada.
- `POST /public-records/sync` body `{uasg,from,to}` → `{created,updated,total}`. Período filtra início da vigência na API pública; informar isso na UI. Não sobrescrever documentos locais.
- `GET /public-records/:id` → `PublicRecordDetail` local.
- `POST /public-records/:id/refresh` → `PublicRecordDetail`. Cabeçalho e itens por numeroControlePncpAta. Enriquecer com contratação por idCompra quando disponível para processo, organização, modalidade e unidades de medida via correspondência exata de item. Ausência de contratação não perde os dados da ata. Manter dados auxiliares já consultados quando identidade do item permanece igual.
- `POST /public-records/:id/items/:itemKey/refresh` → `ItemSupplement`. itemKey é número do item (URL-encoded), validado existir na ata. Consultar unidades, empenhos e adesões separadamente; empenhos endpoint é por ata e precisa filtro local EXATO por item; proteger dados de outros fornecedores quando disponíveis. Persistir resultados em snapshot e timestamp. Falha em uma parte preserva cache anterior dessa parte e informa error/lastSyncedAt, nunca troca por [] falso. Quando não for possível discriminar fornecedor nos dados públicos, informar que o escopo é o item da ata.
- `POST /public-records/:id/draft` body `{supplierDocument}` → `{id,created:boolean}` do PriceRecord local. Necessário detalhe carregado e fornecedor presente na ata; em múltiplos fornecedores seleção explícita. Filtrar itens desse fornecedor, enriquecer com metadados públicos disponíveis, manter campos desconhecidos vazios para o editor. Repetir origem+fornecedor devolve rascunho existente sem gravar novos dados. Ata oficial mantém o número da fonte. Não criar ata de pregão não-SRP nem de resultado cancelado.

`PublicRecordSummary`: `{id,externalId,number,uasg,unitName,organizationName,purchaseExternalId,purchasePncpId,purchaseNumber,purchaseYear,object,startDate,endDate,totalValue:string|null,itemsCount:number|null,situation,lastSyncedAt,detailsSyncedAt,linkedPurchaseId:string|null}`.
`PublicRecordDetail` acrescenta `{items:PublicRecordItem[],suppliers:{document,name}[],processNumber,organizationDocument,city,state}`.
`PublicRecordItem`: `{key:string,number:string,description,unit,quantity:string|null,unitPrice:string|null,totalValue:string|null,brand,model,supplierDocument,supplierName,supplement?:ItemSupplement}`. Se mesmo item tem fornecedores diferentes, arrays preservam linhas; key para consulta auxiliar pode ser número do item pois escopo público é item/ata, não documento do fornecedor.
`ItemSupplement`: `{units:SupplementPart<UnitRow>,commitments:SupplementPart<CommitmentRow>,adhesions:SupplementPart<AdhesionRow>}`.
`SupplementPart<T>`: `{status:'loaded'|'error'|'not_loaded',data:T[],lastSyncedAt:string|null,error:string|null}`. Data anterior pode existir com statuserror e deve ser identificada como última consulta salva.
`UnitRow`: `{code,name,type,supplierDocument,quantity:string|null,adhesionBalance:string|null,commitmentBalance:string|null,excluded:boolean}`.
`CommitmentRow`: `{unit,type,quantity:string|null,committed:string|null,balance:string|null}`.
`AdhesionRow`: `{unit,approvedAt:string|null,quantity:string|null}`.

## Banco e relação com documentos

Dois novos modelos PublicPurchase e PublicRecord: colunas pesquisáveis, snapshots JSON e timestamps de atualização/detalhe. Identidade de PublicPurchase é idCompra; PublicRecord é controle PNCP da ata. Vincular pelos identificadores opacos completos, não por número/ano inferido.

PriceRecord ganha `sourcePublicRecordId` e `sourceSupplierDocument` opcionais com identidade única do par; finalidade é idempotência de preparação. Para suportar a mesma ata oficial em documentos de fornecedores distintos, substituir a unicidade antiga number+uasg por number+uasg+supplierDocument. Adaptar findUnique composto legado e mensagens de conflito; importação antiga por número continua recusando substituir qualquer ata local existente. Nunca modificar migration já aplicada; migration nova altera índice e adiciona modelos/campos sem remover dados. Não introduzir autenticação, Redis, FastAPI extra, agendamento, carrinho de empenho ou assinaturas.

## Fonte oficial

OpenAPI https://dadosabertos.compras.gov.br/v3/api-docs, conferida31/10/2026. Endpoint de contratação/itens/resultados direto por `tipo=idCompra&codigo=...`; ARPs por `numeroControlePncpAta`. Participantes: /modulo-arp/3_consultarUnidadesItem (numeroAta,unidadeGerenciadora,numeroItem). Empenhos: /modulo-arp/4_consultarEmpenhosSaldoItem (numeroAta,unidadeGerenciadora), filtrar numeroItem depois. Adesões: /modulo-arp/5_consultarAdesoesItem (numeroAta,unidadeGerenciadora,numeroItem). Página entre10 e500, respeitar todas as páginas; nenhuma UASG/órgão fixos em código.
