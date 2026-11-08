# Briefing para desenvolvimento do sistema de gestão do fluxo de contratações

**Origem:** fluxograma geral de compras e contratações do IFMS, conforme IN PROAD/IFMS nº 02/2023, Portaria Reitoria 1370/2023 e Lei 14.133/2021.
**Objetivo:** substituir o controle manual (planilhas, e-mails e conferência visual do fluxograma) por um sistema que conduza o processo etapa a etapa, gere os documentos, cobre prazos e permita rastrear qualquer informação.

> **Situação: em espera desde 2026-11-08 — ideia mantida para continuidade futura.**
> O projeto não tem acesso ao SUAP, que este briefing exige como processo eletrônico oficial (§8).
> Sem essa integração, o sistema não será integrado ao Contracts Ext. Veja a [seção 10](#10-situação-no-contracts-ext)
> para o que já existe, o que bloqueia e a condição para retomar.

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

---

## 10. Situação no Contracts Ext

*Registrado em 2026-11-08.*

### Por que está em espera

O §8 define o SUAP como processo eletrônico oficial: os autos, a numeração e a tramitação permanecem nele, e o novo sistema deve integrar sem duplicar. O projeto não tem acesso ao SUAP. Construir o núcleo do fluxo (Fase 1) sem essa integração obrigaria a registrar cada movimentação duas vezes, e o painel de acompanhamento deixaria de ser confiável. Por isso o sistema descrito aqui não será integrado ao Contracts Ext enquanto o bloqueio existir.

### Condição para retomar

Obter acesso de leitura aos processos eletrônicos do SUAP (API ou outra forma autorizada pela TI do IFMS, com credencial de serviço), cobrindo pelo menos número do processo, etapa ou setor atual, histórico de tramitação e documentos. Antes disso, confirmar com a TI se a API do SUAP expõe processos eletrônicos e se a instituição libera o acesso a sistemas terceiros.

### O que o Contracts Ext já oferece e poderá ser reaproveitado

O Contracts Ext hoje consulta o fim do processo (ata, contrato, empenho e pagamento) a partir de fontes públicas.

| Item do briefing | Base existente no projeto |
|---|---|
| Integração Contratos.gov.br (§4, Fase 4) | Réplica diária automática de contratos, com aditivos, garantias, responsáveis, itens, faturas e arquivos |
| Integração Compras.gov.br: resultado, IRP e ARP (§4, Fase 4) | Catálogo de pregões e atas, com participantes, empenhos e saldos e adesões |
| Documentos por modelo: ARP (§4, Fase 2) | Gerador de ata em DOCX/PDF com rascunho, pendências e histórico de geração |
| Entidades Contrato, Empenho e Ata de registro de preços (§6) | Contratos replicados, empenhos, liquidações, pagamentos, LOA e vínculo contrato ↔ empenho |
| Alertas de ARP (vigência e saldo) e janela de prorrogação (§5) | Dados disponíveis; as regras estão previstas na etapa de fatos derivados do roadmap atual |
| Escopo por unidade e UASG gerenciadora 158132 (§8) | Cadastro de instituições e UASGs com acesso restrito por UASG |

### O que ainda não existe

Entidade Processo, etapas e tramitação, checklists, pesquisa de preços, itens do PCA, portarias e designações com vigência, demanda compartilhada, perfis por processo com segregação de funções (hoje há quatro papéis por instituição) e trilha de auditoria por processo.

### Ponto de partida sugerido ao retomar

1. Criar o Processo como âncora dos registros já existentes: pregão ou ata do catálogo, contrato replicado e empenhos. Assim o encerramento (§3, bem ou serviço) nasce preenchido com dados públicos verificados.
2. Generalizar o gerador de ARP para modelos versionados, registrando a versão da AGU usada em cada processo (§8).
3. Implementar o núcleo do fluxo (Fase 1) já lendo a tramitação do SUAP, sem registro duplicado.

### Materiais relacionados

- Painel HTML com as seis visualizações (macrofluxo, raias, estados, decisões, modelo de dados e requisitos), citado no §6. Ainda não está versionado no repositório.
- Rascunhos anteriores da mesma ideia: um schema Prisma com atividades, etapas concluídas e notificações de etapa, e listas de funcionalidades (solicitações de empenho, repositório de documentos por categoria, modelos de documentos, instrução de processos licitatórios e elaboração de ETP). Estão hoje como arquivos soltos e não versionados em `apps/api/src/`.
