# Contracts Ext — proposta de implementação

Data: 30/10/2026. Estado: proposta para revisão do usuário.

## Objetivo

Aplicação independente para acompanhar contratos e produzir atas de registro de preços a partir de um modelo Word. Sem autenticação, papéis, permissões, dependência de serviços ou banco do SAGA/DIRAD. O reaproveitamento será de código e padrões de integração, com adaptação ao domínio próprio.

Interpretação de “dois módulos”: Contratos e Atas/documentos. A exportação inicial é da ata, conforme o módulo analisado anteriormente. A geração de instrumento contratual é outra funcionalidade e não está implícita nesta proposta.

## Abordagens consideradas

1. Recomendada: monorepo com Next.js, uma API NestJS, PostgreSQL e Gotenberg. Integrações públicas ficam em adaptadores da API. Mantém as tecnologias centrais e reduz processos para operar.
2. Reprodução da separação original: acrescentar FastAPI e Redis para compras. Permite reaproveitar mais Python diretamente, mas aumenta a infraestrutura para apenas dois módulos.
3. Next.js com API embutida: menor infraestrutura, mas não mantém o backend NestJS separado solicitado como referência.

## Arquitetura proposta

- `apps/web`: Next.js, React, TypeScript, Tailwind e componentes acessíveis.
- `apps/api`: NestJS, Prisma e validação de entradas; módulos de contratos, atas e exportação.
- PostgreSQL: armazenamento próprio, migrações versionadas e volume persistente.
- Gotenberg: conversão do DOCX preenchido para PDF.
- Docker Compose: web, API, banco e conversor; inicialização documentada com um comando.
- Configuração por variáveis de ambiente para portas, banco e APIs externas.
- Navegador acessa a API por mesma origem através do frontend; banco e conversor ficam na rede interna do Compose.

## Módulo Contratos

- Listar, pesquisar, filtrar por unidade, período e situação; paginação no backend.
- Detalhe do contrato: número, objeto, fornecedor, CNPJ/CPF, unidade, vigência e valores.
- Cadastro, edição e exclusão com confirmação para registros locais.
- Importação manualmente acionada do Compras.gov.br por UASG e período, com tratamento de paginação, falhas e duplicidade.
- Identificar origem e última importação. Importações atualizam os registros da mesma origem sem criar duplicatas.
- Indicadores calculados sobre o filtro: quantidade, valor global e vencimentos nos próximos 30 dias.
- Situação derivada da vigência: a iniciar, vigente, vencendo, vencido e sem vigência, conforme datas disponíveis.
- Dados importados continuam consultáveis quando o serviço externo não responde.

## Módulo Atas e documentos

- Listagem de atas persistidas, busca e detalhe.
- Editor de cabeçalho: número, processo, compra, modalidade, objeto, vigência e possibilidade de renovação.
- Dados da organização, endereço e autoridade signatária preenchidos na própria ata.
- Dados do fornecedor e representante; uma ata/documento por fornecedor para evitar a limitação de usar o primeiro fornecedor de uma lista heterogênea.
- Itens editáveis: número, descrição, marca, modelo, unidade, quantidades, valor unitário e garantia.
- Importação de ata do Compras.gov.br por UASG e identificação da ata; campos indisponíveis permanecem explicitamente pendentes de preenchimento.
- Modelo Word inicial incorporado ao projeto, adaptado do exportador analisado, sem identidade visual SAGA/DIRAD nem dados institucionais fixos.
- Exportação da ata completa ou de item selecionado em DOCX e PDF.
- Validação prévia lista os campos necessários ainda ausentes, com acesso ao editor para completá-los.
- Valores monetários calculados com precisão decimal no backend; formatação brasileira apenas na apresentação/documento.
- Registro das exportações com formato, data, versão do modelo e fotografia dos dados utilizados; download gerado pela API.
- Falha do conversor afeta PDF; DOCX permanece disponível.

## Banco

Entidades principais: Contract, PriceRecord, PriceRecordItem e DocumentExport. Os dados cadastrais de organização e signatários ficam associados à ata para manter o escopo em duas áreas funcionais. Contratos importados usam identificador externo e unidade para deduplicação. Itens pertencem a uma ata e são removidos em cascata quando ela é excluída.

## Interface

Nome de trabalho: Contracts Ext. Todo o conteúdo em português brasileiro.

Direção visual: escritório editorial contemporâneo; fundo marfim, texto verde profundo, acento terracota e tipografia de leitura com títulos marcantes. Navegação lateral compacta com apenas Contratos e Atas & documentos. Predominância de tabelas, divisórias e espaços bem definidos, com detalhes/editor em páginas próprias. Indicadores discretos e hierarquia clara de ações.

Filtros refletem o resultado real. Estados de carregamento, falha, ausência de dados e importação possuem mensagens e ações úteis. Layout responsivo preserva edição e exportação; foco visível, rótulos de formulário e uso por teclado. Dados de demonstração são identificados e disponibilizados por seed opcional, sem mascarar erros de API.

## Verificação e entrega

- Testes de regras de vigência, valores e deduplicação; integrações externas simuladas nos testes.
- Teste de geração DOCX com inspeção do conteúdo e preservação da tabela de itens.
- Teste de integração da API com PostgreSQL e fluxo de cadastro/edição.
- Verificação real do Compose, persistência após reinício, exportação DOCX/PDF e navegação no frontend.
- Build e lint dos aplicativos; inspeção visual em tela ampla e móvel.
- README com início rápido, configurações, migrações, importação e uso do modelo.

## Fora do escopo

Login, usuários, permissões, multi-instituição com isolamento de acesso, orçamento, empenhos, tramitação de processos, notificações por e-mail, assinatura eletrônica, gestão de fiscais, aditivos, agendamento de sincronização e editor visual de modelos. A aplicação não terá chamadas a SAGA/DIRAD.

## Ambiente observado

Diretório inicial vazio. Node 22, pnpm e Docker com daemon acessível disponíveis. Há acesso de leitura aos códigos de referência. Nenhum código de implementação foi criado nesta etapa.
