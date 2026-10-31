# Detalhes de pregões: paginação e consulta parcial de atas

Solicitação do usuário: reduzir a lista longa de itens após atualizar detalhes e melhorar as mensagens da consulta de atas. Caso reportado: pregão local `d932468e-3d4a-4c5c-95a1-1e12f4572361`, número 90260/2025, UASG 158132.

## Diagnóstico e decisões

A resposta real da unidade contém 279 registros. O pregão tem 44 atas vinculadas: 29 com controle PNCP e 15 sem esse identificador. A validação anterior interrompia a consulta inteira. Não é ausência de atas, nem se deve inventar uma identidade para abrir as atas incompletas.

- Paginar os itens salvos localmente, com 5 por página por padrão e opções 5/10/25. Busca por número, descrição ou fornecedor, controles no início e fim e foco no título ao mudar de página. Manter todos os resultados e cancelamentos de cada item.
- Selecionar o pregão por identidade exata antes de validar identificadores das atas. Importar as atas identificadas e informar separadamente os números retornados sem controle PNCP.
- Persistir o resultado parcial em `snapshot.recordsLookup`, junto da data de consulta existente. Mesclar seções JSONB atomicamente para que atualização dos detalhes e consulta de atas preservem os resultados uma da outra.
- Diferenciar consulta vazia concluída, consulta parcial e falha externa. Em falha, manter as atas anteriores e oferecer nova tentativa; não exibir um falso estado vazio.

## Verificação

- [x] Reproduzir a falha com dados simulados antes da correção e conferir a resposta real do pregão informado.
- [x] Testar atas incompletas relacionadas/não relacionadas, resultado parcial e ausência confirmada.
- [x] Conferir no PostgreSQL que GET e atualização dos detalhes preservam o aviso parcial e os itens.
- [x] Revisão independente do código.
- [x] Build, lint, suíte completa e teste de navegador da paginação/consulta parcial.
- [x] Validar em Docker o pregão reportado e registrar o resultado.
