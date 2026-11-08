# Briefing para desenvolvimento do sistema de gestão do fluxo de contratações

**Origem:** fluxograma geral de compras e contratações do IFMS, conforme IN PROAD/IFMS nº 02/2023, Portaria Reitoria 1370/2023 e Lei 14.133/2021.
**Objetivo:** substituir o controle manual (planilhas, e-mails e conferência visual do fluxograma) por um sistema que conduza o processo etapa a etapa, gere os documentos, cobre prazos e permita rastrear qualquer informação.

---

## 1. Problema atual

- O fluxo tem 15 etapas, mais de uma dezena de setores envolvidos e ramificações que mudam conforme o tipo de contratação.
- O acompanhamento depende de planilha de controle preenchida manualmente e de consulta caso a caso no SUAP.
- A demanda compartilhada entre campi circula por e-mail com planilha do Drive, sem prazo controlado nem consolidação automática.
- Não há indicador de gargalo: não se sabe quanto tempo o processo fica parado em cada etapa nem quantas vezes retornou para adequação.

## 2. Conceito central do sistema

O processo é uma **máquina de estados**. Ele está sempre em um único estado, com um responsável atual e uma lista de pendências. A transição para o próximo estado só ocorre quando os documentos obrigatórios daquela etapa estiverem anexados e assinados por quem tem competência vigente.

Três regras não negociáveis:

1. **Nada avança com pendência obrigatória em aberto.**
2. **Todo retorno é registrado** com motivo, responsável e data, para medir retrabalho.
3. **Nenhum documento é substituído em silêncio.** Toda alteração gera nova versão com autor e data.

## 3. Perguntas que definem o fluxo de cada processo

Respondidas na abertura, alteráveis até a aprovação da autoridade superior. A partir delas o sistema monta a lista de tarefas e o checklist daquele processo:

1. Forma de contratação: licitação, contratação direta (dispensa ou inexigibilidade), emergencial ou IRP participante.
2. É Sistema de Registro de Preços?
3. O objeto é bem ou serviço?
4. A unidade é executora ou participante?
5. Há mão de obra exclusiva? (define a planilha de custos)
6. É contratação de TIC ou engenharia? (define análises adicionais)

## 4. Módulos, em ordem sugerida de entrega

### Fase 1 · Núcleo do fluxo
Cadastro de processo, etapas, responsáveis, tramitação e painel de acompanhamento com tempo de permanência por etapa. Entrega isolada já resolve a rastreabilidade, que hoje é o maior custo do setor.

### Fase 2 · Documentos por modelo
Geração de DFD, DML, ETP, TR, ARP, termo de contrato, declarações e certificações a partir de modelos com campos preenchidos pelos dados já cadastrados. Controle de versão do modelo utilizado.

### Fase 3 · Demanda compartilhada
Substitui a planilha por e-mail. A unidade executora publica a demanda, os campi respondem no sistema com prazo, e o DFD consolidado sai pronto. Inclui a consulta a almoxarifado, contratos e TIC dentro do sistema.

### Fase 4 · Integrações
SUAP (processo, numeração, tramitação e documentos), Compras.gov.br (PCA, ETP digital, riscos, Catmat e Catser, IRP), Contratos.gov.br, PNCP e SICAF.

### Fase 5 · Indicadores
Tempo médio por etapa, gargalos, taxa de retorno por setor, previsão de conclusão e relatórios para decisão da direção.

## 5. Alertas obrigatórios

| Categoria | Alerta |
|---|---|
| Processo | Parado além do prazo previsto da etapa |
| Processo | Prazo de resposta das unidades participantes vencendo |
| Processo | Pesquisa de preços com validade expirada antes da deflagração |
| Contratação | ARP próxima do fim da vigência e saldo de itens |
| Contratação | Contrato entrando na janela de prorrogação |
| Contratação | Entrega de bem em atraso |
| Conformidade | Portaria de designação vencida |
| Conformidade | Documento obrigatório ausente na etapa atual |
| Conformidade | Ressalva de parecer jurídico sem resposta |

## 6. Entidades mínimas

Processo, Etapa do processo, Documento, Item, Item do PCA, Unidade participante, Pessoa e perfil, Portaria e designação, Pesquisa de preços, Ata de registro de preços, Contrato, Empenho, Checklist, Trilha de auditoria.

O detalhamento dos campos está na visualização 05 do painel HTML que acompanha este briefing.

## 7. Perfis de acesso

Demandante, Comissão de ETP, Setor de contratações, Contratos, Orçamento, Finanças, Controladoria, Autoridade superior, Agente de contratação, Almoxarifado e Unidade participante.

Um usuário pode acumular perfis, mas o sistema deve impedir acúmulos que firam a segregação de funções: quem elabora não aprova, e quem fiscaliza não atesta a própria demanda.

## 8. Restrições conhecidas

- A UASG gerenciadora das licitações é sempre a 158132, ainda que a demanda seja cadastrada na UASG do campus.
- Os modelos de TR, contrato e edital seguem versões da AGU que mudam periodicamente. O sistema precisa suportar troca de modelo sem quebrar processos em andamento.
- O SUAP continua sendo o processo eletrônico oficial. O novo sistema conduz e organiza, mas os autos permanecem no SUAP, o que exige integração e não duplicação.
- A competência para autorizar vem de portaria com vigência, não do cargo.

## 9. Como validar a entrega

Para cada fase, o critério de aceite é conseguir responder, em uma tela e sem consultar planilha:

- Onde está este processo, com quem, há quantos dias e o que falta?
- Quais processos da unidade estão atrasados e em qual etapa?
- Este item foi previsto no PCA, quanto foi estimado, quanto foi homologado e quanto foi entregue?
- Quais campi participam desta compra e quais ainda não responderam?
- Quem assinou cada documento e sob qual portaria?
