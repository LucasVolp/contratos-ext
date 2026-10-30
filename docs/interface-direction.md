# Direção de interface — Contracts Ext

Aplicar frontend-design. Produto em pt-BR, identidade independente e sem logos, shell, tema ou componentes copiados de SAGA/DIRAD.

## Conceito: arquivo de trabalho contemporâneo

Uma mesa de trabalho editorial, clara e precisa. Navegação fixa à esquerda em desktop (236px), marca tipográfica `contratos` com um pequeno selo `EXT` terracota; separador e links Contratos / Atas & documentos numerados 01/02. Base do sidebar mostra marca de aplicação local/versão discreta. Em mobile a navegação vira barra superior compacta com dois links; nada de sidebar enorme ou menu invisível.

Paleta sugerida: canvas #F7F6F0; superfície #FEFDF8; texto #203D34; secundário #68766C; linha #DFE3D8; verde #294D3C; acento #B65E3C; sucesso #397054; alerta #A4622C; erro #A43C3C. Verificar contraste. Títulos em Fraunces (arquivos locais public/fonts/fraunces-400/500/600.ttf), corpo DM Sans (400/500/600/700). Sem dependência Google Fonts em runtime/build.

Tela de listagem: breadcrumb discreto `Área de trabalho / Contratos`; etiqueta `01 — GESTÃO CONTRATUAL`; título grande serif, subtítulo curto com propósito e ações no canto superior direito. Estatísticas em uma faixa horizontal separada por linhas, com títulos pequenos, números tabulares e detalhes pertinentes. Evitar cards idênticos flutuantes. Uma linha de filtros integrada à tabela; cabeçalho de tabela com fundo levemente tingido, linhas altas e objetos legíveis; status com ponto e texto, fornecedor com iniciais discretas. Números de contrato são links de detalhe, com seta no fim da linha. Rodapé de tabela mostra contagem e paginação real. Borda pequena 8px, sem sombras genéricas.

Atas: listagem documental com identidade de folha/página e total/itens, ação clara “Nova ata”; pode usar tabela para legibilidade. Ao abrir, mostrar status “Pronta para exportar” ou “Preenchimento pendente”, metadados, itens e painel lateral com escolha ata completa/item, botões “Baixar DOCX” e “Baixar PDF”, lista de pendências e histórico. O editor usa seções numeradas com bom espaçamento: identificação; organização; signatário; fornecedor; itens. Campos opcionais claramente opcionais. Dados obrigatórios só para exportação permitem salvar rascunho. Uma faixa sticky discreta no editor oferece voltar/salvar. Para itens usar cartões colapsáveis ou blocos em mobile com todos campos acessíveis.

## Rotas e acessibilidade

- `/` redireciona `/contratos`.
- `/contratos`, `/contratos/novo`, `/contratos/importar`, `/contratos/[id]`, `/contratos/[id]/editar`.
- `/atas`, `/atas/nova`, `/atas/importar`, `/atas/[id]`, `/atas/[id]/editar`.
- Busca com rótulo acessível exato `Buscar contratos` / `Buscar atas`.
- Download DOCX com botão rótulo `Baixar DOCX`, PDF `Baixar PDF`.
- Todos inputs têm label visível, erros junto do campo ou alertas úteis, aria-live em resultados de ações, foco visível, skip-link.
- Não usar modais para formulário/fluxo principal. Exclusão pode confirmar com dialog nativo acessível.
- Mostrar estados de carregamento, servidor indisponível com retry, vazio com ação para cadastrar/importar. Dados de demonstração nunca fallback para falha.
- Preços formatados em pt-BR e tabular-nums; campos decimais aceitam entrada brasileira e convertem para string decimal no payload.
- UI não deve mencionar Prisma, Docker, snapshot, DTO, banco ou nomes de classes. Histórico mostra data, formato e modelo apenas se útil.
- Mensagens em português, sem placeholders em inglês. Não esconder erro de API com dados falsos.

## Integração

Usar docs/api-contract.md; funções fetch client em lib/api.ts com AbortController para busca e falhas claras. Usar proxy `/api/[...path]` route handler com runtime env API_INTERNAL_URL (não rewrite build-time) e encaminhar binários e headers Content-Disposition. API backend /api/*, base interna http://api:4100 no Docker. Metadata/status em domínio, nunca adicionar auth.
