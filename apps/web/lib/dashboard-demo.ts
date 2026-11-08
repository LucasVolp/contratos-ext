// Explicit fixtures for the approved dashboard demonstration. Never used as an API fallback.
export const demoFinancialAmounts = {
  year: { institution: ["24800000", "19600000", "17200000"], rectory: ["8400000", "6200000", "5600000"] },
  month: { institution: ["1200000", "940000", "820000"], rectory: ["420000", "310000", "280000"] },
};
export const demoTasks = [
  { id: "ata", type: "signature", title: "Ata de registro de preços nº 018/2026", description: "Equipamentos de informática · Reitoria", deadline: "Hoje", urgent: true, action: "Revisar documento", detail: "Exemplo de documento aguardando sua assinatura. Objeto: aquisição de equipamentos de informática. Valor ilustrativo: R$ 186.400,00. Signatário: perfil de exemplo." },
  { id: "contract", type: "signature", title: "Termo aditivo nº 02 · Contrato 005/2025", description: "Limpeza e conservação · Campus de exemplo", deadline: "Até 10 nov", urgent: false, action: "Revisar documento", detail: "Exemplo de termo aditivo para prorrogação de vigência. Prazo ilustrativo: 12 meses. A revisão e a assinatura apresentadas aqui são apenas demonstrações visuais." },
  { id: "process", type: "pending", title: "Completar instrução do processo 024/2026", description: "Material de expediente · Reitoria", deadline: "Até 12 nov", urgent: false, action: "Ver pendência", detail: "Pendência ilustrativa: juntar a justificativa da contratação e confirmar a unidade demandante. O fluxo processual será definido em uma etapa futura." },
];
