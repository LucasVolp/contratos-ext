# Modelo de ata

`arp-ata-14133.docx` conserva a diagramação, estilos, tabelas e numeração do modelo Word fornecido no projeto de referência. A adaptação elimina alternativas de edição (`OU`, `XX`, tabelas vazias de reserva) e preenche os dados locais da organização, autoridade, fornecedor e itens. Não contém instituição fixa.

Participantes, adesão e cadastro de reserva remetem aos documentos do procedimento, pois esses dados não fazem parte do cadastro local. Portaria e matrícula são condicionais. A vigência usa as datas cadastradas quando ambas existem, ou remete ao instrumento convocatório. O documento inclui o CNPJ/CPF do fornecedor e seu representante, quando informado.

Versão dos snapshots: `arp-ata-14133-standalone-v2`. O script `../scripts/adapt-template.py` permite reproduzir a adaptação com o caminho do original como argumento; o original não é necessário para executar o sistema.

## Importação pública

A API oficial de contratos disponibiliza `valorGlobal`, mas não um campo de valor inicial. Na importação, `initialValue` recebe o valor global como referência inicial editável. A interface permite corrigir o valor; nenhum cálculo usa ponto flutuante binário.

A versão v2 normaliza texto preto e regular, remove marcações de edição e entradas numeradas vazias, mantém subtítulos junto ao texto seguinte e usa tabela com fonte de 9 pt, larguras ajustadas, cabeçalhos repetidos e linhas de itens indivisíveis. A referência de compra inclui o ano quando ainda não consta no número.
