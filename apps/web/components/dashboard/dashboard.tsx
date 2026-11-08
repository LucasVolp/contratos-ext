"use client";

import { useState } from "react";
import { PageHead } from "@/components/ui";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { AttentionQueue } from "./attention-queue";
import { DashboardSummaries } from "./summaries";
import { Notifications } from "./notifications";

/** Approved demonstration: no institutional queries or persistent workflow mutations. */
export function Dashboard() {
  const [scope, setScope] = useState("institution");
  const [period, setPeriod] = useState("year");
  const [message, setMessage] = useState("");

  return (
    <section className="dashboard" aria-label="Painel de gestão">
      <p className="dashboard-demo-notice">Demonstração · dados fictícios. Nenhuma consulta pública realizada.</p>
      <div className="dashboard-masthead">
        <PageHead title="Painel de gestão" />
        <div className="dashboard-scope">
          <div>
            <Label htmlFor="dashboard-scope">Abrangência do exemplo</Label>
            <NativeSelect id="dashboard-scope" value={scope} onChange={(event) => setScope(event.target.value)}>
              <option value="institution">Todas as unidades</option>
              <option value="rectory">Reitoria de exemplo</option>
            </NativeSelect>
          </div>
          <div>
            <Label htmlFor="dashboard-period">Período financeiro</Label>
            <NativeSelect id="dashboard-period" value={period} onChange={(event) => setPeriod(event.target.value)}>
              <option value="year">2026 · acumulado</option>
              <option value="month">Novembro · até 08 nov</option>
            </NativeSelect>
          </div>
        </div>
      </div>
      <div className="dashboard-panorama">
        <DashboardSummaries rectory={scope === "rectory"} monthly={period === "month"} />
      </div>
      <p className="dashboard-panorama-source">Valores e posições ilustrativos · referência em 08 nov 2026 · nenhuma fonte oficial consultada</p>
      <div className="dashboard-layout">
        <div className="dashboard-primary"><AttentionQueue announce={setMessage} /></div>
        <aside className="dashboard-secondary" aria-label="Acompanhamento"><Notifications announce={setMessage} /></aside>
      </div>
      <div className="dashboard-feedback" role="status" aria-live="polite" aria-atomic="true">{message}</div>
    </section>
  );
}
