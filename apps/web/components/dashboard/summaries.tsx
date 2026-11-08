import { Banknote, Files, GitBranch } from "lucide-react";
import { compactMoney } from "@/lib/decimal-display";
import { demoFinancialAmounts } from "@/lib/dashboard-demo";

export function DashboardSummaries({ rectory, monthly }: { rectory: boolean; monthly: boolean }) {
  const finance = demoFinancialAmounts[monthly ? "month" : "year"][rectory ? "rectory" : "institution"].map(compactMoney);
  const active = rectory ? "18" : "42";
  const processes = rectory ? [3, 2, 4, 1] : [8, 5, 7, 4];
  return <>
    <section className="dashboard-panel dashboard-finance" aria-labelledby="finance-summary-title">
      <header className="dashboard-section-head"><div><span className="dashboard-kicker"><Banknote size={14} aria-hidden="true" /> FINANCEIRO</span><h2 id="finance-summary-title">Execução da despesa</h2></div><span className="dashboard-asof">{monthly ? "01 a 08 nov 2026" : "01 jan a 08 nov 2026"}</span></header>
      <dl className="dashboard-financial-stages">{["Empenhado", "Liquidado", "Pago"].map((label, index) => <div key={label}><dt><i className={`dashboard-stage-${index}`} />{label}</dt><dd>{finance[index]}</dd></div>)}</dl>
      <div className="dashboard-financial-note"><strong>{rectory ? "67%" : monthly ? "68%" : "69%"}</strong><span>do valor empenhado já foi pago no período.</span></div>
    </section>
    <div className="dashboard-domain-grid">
      <section className="dashboard-panel" aria-labelledby="contracts-summary-title">
        <header className="dashboard-section-head"><div><span className="dashboard-kicker"><Files size={14} aria-hidden="true" /> CONTRATOS</span><h2 id="contracts-summary-title">Vigência e compromissos</h2></div></header>
        <div className="dashboard-domain-total"><strong>{active}</strong><div>contratos vigentes<small>{compactMoney(rectory ? "6800000" : "18600000")} em valor contratado</small></div></div>
        <dl className="dashboard-contract-facts"><div><dt>Vencem em até 30 dias</dt><dd>{rectory ? "2" : "4"}</dd></div><div><dt>Vencem entre 31 e 90 dias</dt><dd>{rectory ? "3" : "7"}</dd></div></dl>
        <div className="dashboard-contract-warning"><ClockIcon /><div><strong>Próximo vencimento · 23 nov</strong><span>012/2025 · Manutenção de elevadores</span></div></div>
      </section>
      <section className="dashboard-panel" aria-labelledby="processes-summary-title">
        <header className="dashboard-section-head"><div><span className="dashboard-kicker"><GitBranch size={14} aria-hidden="true" /> PROCESSOS</span><h2 id="processes-summary-title">Andamento das contratações</h2></div></header>
        <div className="dashboard-domain-total"><strong>{rectory ? "10" : "24"}</strong><div>processos em andamento<small>Distribuição pela etapa atual</small></div></div>
        <dl className="dashboard-process-stages">{["Planejamento", "Instrução", "Análise jurídica", "Formalização"].map((label, i) => <div key={label}><dt>{label}</dt><dd><span className="dashboard-process-track" aria-hidden="true"><i style={{ width: `${processes[i] / (rectory ? 10 : 24) * 100}%` }} /></span><strong>{processes[i]}</strong></dd></div>)}</dl>
      </section>
    </div>
  </>;
}

function ClockIcon() {
  return <span className="dashboard-warning-dot" aria-hidden="true">●</span>;
}
