# @contracts/validation

Biblioteca pura compartilhada entre API Node/CommonJS e navegador. Sem rede,
sem dependências e sem etapa de compilação. `index.d.ts` descreve as exportações.

- `normalizeDocument(value)`: remove somente pontos, barras, hífens e espaços;
  mantém letras e normaliza para maiúsculas.
- `isCPF`, `isCNPJ`: validam estrutura e dígitos verificadores. CNPJ aceita
  números e o formato alfanumérico da Receita Federal (12 posições + 2 DVs).
- `isUASG`, `isUF`, `isDate`: UASG como string de 6 dígitos, 27 UFs e data real
  no formato ISO de calendário.
- `parseDecimal(value)`: retorna string canônica exata ou `null`. Aceita decimal
  com ponto e valores brasileiros com vírgula e prefixo opcional `R$`. Limita a
  18 inteiros e 6 decimais, rejeitando sinais e precisão excedente.
- `formatDecimal(value, currency?)`: formata sem conversão para Number e sem
  arredondar; moeda mantém pelo menos 2 casas. Valores inválidos ficam visíveis.
- `maskDocument(value, cnpjOnly?)`: máscara progressiva para CPF/CNPJ.
- `validateFields(body, kind?)`: retorna `FieldErrors` para `record`, `contract`
  ou `import`. Rascunhos aceitam campos opcionais vazios; valores informados
  precisam ser válidos. Erros de itens usam `items.{index}.{campo}` (índice zero).
- `blurFieldErrors(previous, current, name)`: atualiza erros do campo que perdeu
  foco e suas dependências (datas, quantidade/mínima e números de itens),
  preservando os demais campos sem revelar obrigatórios ainda não tocados.
- `validateFilters(body)`: valida somente UASG e datas fornecidas em filtros.

A API usa o mesmo mapa em respostas HTTP 400 `{message, fieldErrors}`. Máscaras
são apresentação: documentos, UF e decimais são normalizados antes de persistir.
Campos adicionais desconhecidos são ignorados.

`pnpm --filter @contracts/validation test` executa testes offline com `node:test`.
