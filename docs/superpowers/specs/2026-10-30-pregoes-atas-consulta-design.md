# Ampliação: pregões e consulta de atas publicadas

Estado: recorte completo aprovado pelo usuário em31/10/2026, incluindo validações e máscaras dos formulários.

## Base existente

Contracts Ext já possui contratos e um arquivo de atas editáveis com exportação DOCX/PDF. A ampliação mantém esse arquivo e acrescenta consulta dos dados públicos da compra e das atas publicadas, em banco próprio. Não há autenticação nem chamadas aos sistemas de referência.

## Referências analisadas

- SAGA-IFRO: listagem/detalhe de pregões e atas, itens, participantes, empenhos/saldos, adesões e exportação.
- LucasVolp/saga no clone SAGA-PRO: consolidação dos resultados por fornecedor vencedor, vínculo compra→ata, tratamento de SRP e atas com vigência no exercício seguinte.
- Reaproveitar regras e integração, mantendo páginas/identidade visual próprias do Contracts Ext.

## Recorte recomendado

1. **Pregões:** nova seção de navegação. Consulta/importação por UASG e período, lista com número, objeto, situação, modalidade, SRP, datas e valores. Detalhe com processo, itens e resultados agrupados por fornecedor vencedor. Preservar resultados por item e fornecedor, inclusive múltiplas linhas, situação e cancelamento. Sem resultado válido confirmado, mostrar esse estado sem inventar vencedor ou preço.
2. **Atas publicadas:** segunda visão dentro de Atas & documentos, distinguindo os dados oficiais consultados dos rascunhos/documentos editáveis locais. Lista, busca, vigência, valores e compra de origem; detalhe dos itens, fornecedores e, quando a API disponibilizar, unidades participantes, empenhos/saldos e adesões.
3. **Vínculos:** do pregão para as atas vinculadas; da ata publicada para sua compra e para preparar o documento local. Identidade prioritária por idCompra/controle PNCP, evitando associações só pelo número da compra. Considerar atas com vigência no exercício seguinte ao da compra. A listagem pública de ARPs não filtra por compra: percorrer as páginas e filtrar pelos identificadores oficiais; não presumir que um parâmetro não documentado foi aplicado.
4. **Preparar documento:** importar os dados da ata publicada para o editor existente. Separar documentos por fornecedor; nunca adotar o primeiro fornecedor de uma ata heterogênea. Rascunhos locais já preenchidos permanecem preservados. Esta etapa não inclui emissão de ata provisória para compra ainda sem ata publicada.
5. **Persistência:** guardar consultas e detalhes no PostgreSQL com identidade externa única e data de consulta. Atualização pública explicitamente acionada pelo usuário, sem sobrescrever rascunhos editáveis. Base local continua visível durante indisponibilidade externa, com origem e data claras.
6. **Interface:** continuar a linguagem editorial atual. Navegação em três áreas: Contratos, Pregões e Atas & documentos. Detalhes em páginas próprias, pesquisa e filtros acessíveis; carregamento, ausência real de resultado e erro com nova tentativa distintos.

## Arquitetura

Mesmos quatro serviços Docker. Adaptadores oficiais na API NestJS, novos modelos Prisma para compras e atas publicadas, migrações versionadas. Dados cadastrais e metadados pesquisáveis em colunas; cargas públicas auxiliares preservadas em JSON para evitar reproduzir todo o domínio de compras dos sistemas originais. Frontend via proxy da mesma origem.

## Alternativas

- **Recorte recomendado acima:** visão de consulta suficientemente completa, conectada ao exportador existente, sem operações administrativas de empenho.
- **Versão menor:** apenas listagem/detalhe de pregões, itens/vencedores e vínculo com atas; participantes, saldos e adesões ficam para uma evolução.
- **Reproduzir todos os fluxos originais:** incluir solicitações, carrinho, decisões, empenhos, assinaturas e agendamentos. Não recomendado para o objetivo de um sistema mais simples e sem autenticação.

## Cuidados confirmados na API oficial

- O domínio de modalidade Compras.gov difere do PNCP: Pregão é código5 e Dispensa6 no primeiro. Não reutilizar códigos PNCP nesse campo.
- Preferir endpoints diretos por idCompra para detalhe, itens e resultados, sem inferir ano a partir de posições do identificador.
- A API pública exige tamanho de página de pelo menos10; tratar paginação e indisponibilidade explicitamente.
- SRP falso impede fluxo de preparação de ata a partir de pregão; valor desconhecido deve aparecer como desconhecido.

## Verificação

Testes de mapeamento e vínculo exato entre compra/ata; paginação completa; ausência de resultados; múltiplos fornecedores; indisponibilidade pública sem perda dos dados locais. Integração PostgreSQL e navegação real em Docker, mantendo as regressões atuais de CRUD e documentos. Conferir dados de uma consulta real e layout desktop/móvel.

## Validações e máscaras aprovadas

CPF e CNPJ com validação de dígitos verificadores, incluindo CNPJ alfanumérico conforme Receita Federal; UASG de6 dígitos; UF pertencente ao catálogo brasileiro; valores/quantidades não negativos e com até6 casas decimais; datas reais e intervalos coerentes. Máscaras de apresentação preservam valores canônicos enviados ao backend, sem truncar ou arredondar silenciosamente. Campos opcionais de rascunho continuam opcionais, mas valores preenchidos precisam ser válidos. Número de processo, ata e compra preservam formatos institucionais variados em vez de impor uma máscara única incorreta. Validação ao sair do campo e no envio, erro associado por aria-describedby, foco no primeiro erro, resumo útil, controles acessíveis e bloqueio de gravação inválida. Backend aplica as mesmas regras independentemente do frontend.
