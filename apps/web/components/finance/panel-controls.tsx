"use client";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

import { RefreshCw, SlidersHorizontal } from "lucide-react";
import type { FinanceUnit } from "@/lib/finance-types";
import { Field, focusInvalid } from "@/components/ui";
import { useState } from "react";
export interface ScopeChoice {
  code: string;
  name: string | null;
}
export interface PanelScope {
  managementCode: string;
  fiscalYear: string;
  unit: string;
  fromMonth: string;
  toMonth: string;
}
export function PanelControls({
  scope,
  units,
  agencies,
  onChange,
  onRefresh,
  busy,
  budget = false,
  showPeriod = true,
}: {
  scope: PanelScope;
  units: ScopeChoice[];
  agencies: FinanceUnit[];
  onChange: (changes: Record<string, string>) => void;
  onRefresh: () => void;
  busy: boolean;
  budget?: boolean;
  showPeriod?: boolean;
}) {
  const currentYear = new Date().getFullYear();
  const years = [
    ...new Set([
      scope.fiscalYear,
      ...Array.from({ length: 8 }, (_, i) => String(currentYear - i)),
    ]),
  ];
  const organizations = [
    ...new Map(
      agencies.map((u) => [
        u.managementCode,
        { code: u.managementCode, name: u.managementName },
      ]),
    ).values(),
  ];
  const period = `${scope.fromMonth}-${scope.toMonth}`;
  const periods = [
    { value: "1-12", label: "Ano inteiro" },
    { value: "1-6", label: "1º semestre" },
    { value: "7-12", label: "2º semestre" },
    { value: "1-3", label: "1º trimestre" },
    { value: "4-6", label: "2º trimestre" },
    { value: "7-9", label: "3º trimestre" },
    { value: "10-12", label: "4º trimestre" },
  ];
  return (
    <section className="panel-controls" aria-label="Filtros do painel">
      <div className="panel-primary-filters">
        <div className="field panel-unit-filter">
          <Label htmlFor="panel-unit">
            {budget ? "Unidade orçamentária" : "Unidade"}
          </Label>
          <select
            id="panel-unit"
            value={scope.unit}
            onChange={(e) =>
              onChange({
                [budget ? "budgetaryUnitCode" : "managementUnitCode"]:
                  e.target.value,
              })
            }
          >
            <option value="">
              {budget ? "Todas as unidades orçamentárias" : "Todas as unidades"}
            </option>
            {scope.unit && !units.some((u) => u.code === scope.unit) && (
              <option value={scope.unit}>Unidade {scope.unit}</option>
            )}
            {units.map((u) => (
              <option key={u.code} value={u.code}>
                {u.name || `Unidade ${u.code}`}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <Label htmlFor="panel-year">Exercício</Label>
          <select
            id="panel-year"
            value={scope.fiscalYear}
            onChange={(e) => onChange({ fiscalYear: e.target.value })}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        {!budget && showPeriod && (
          <div className="field">
            <Label htmlFor="panel-period">Período</Label>
            <select
              id="panel-period"
              value={period}
              onChange={(e) => {
                const [fromMonth, toMonth] = e.target.value.split("-");
                onChange({ fromMonth, toMonth });
              }}
            >
              {!periods.some((p) => p.value === period) && (
                <option value={period}>
                  Meses {scope.fromMonth} a {scope.toMonth}
                </option>
              )}
              {periods.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <Button
          className="button secondary panel-refresh"
          type="button"
          onClick={onRefresh}
          disabled={busy || !scope.managementCode}
        >
          <RefreshCw size={15} aria-hidden="true" />
          {busy ? "Consultando…" : "Atualizar painel"}
        </Button>
      </div>
      <details
        className="panel-advanced"
        open={!scope.managementCode || undefined}
      >
        <summary>
          <SlidersHorizontal size={14} aria-hidden="true" />
          Instituição
        </summary>
        {organizations.length > 1 && (
          <div className="field">
            <Label htmlFor="panel-agency">Órgão</Label>
            <select
              id="panel-agency"
              value={scope.managementCode}
              onChange={(e) =>
                onChange({
                  [budget ? "subordinateAgencyCode" : "managementCode"]:
                    e.target.value,
                  managementUnitCode: "",
                  budgetaryUnitCode: "",
                })
              }
            >
              {organizations.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.name || o.code}
                </option>
              ))}
            </select>
          </div>
        )}
        <InstitutionCode
          key={scope.managementCode}
          value={scope.managementCode}
          onSubmit={(code) =>
            onChange({
              [budget ? "subordinateAgencyCode" : "managementCode"]: code,
              managementUnitCode: "",
              budgetaryUnitCode: "",
            })
          }
        />
      </details>
    </section>
  );
}
function InstitutionCode({
  value,
  onSubmit,
}: {
  value: string;
  onSubmit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState("");
  return (
    <form
      className="panel-institution-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!/^[0-9]{5}$/.test(draft)) {
          setError("Informe o código do órgão com 5 dígitos.");
          focusInvalid({
            "panel-management-code": "Informe o código do órgão com 5 dígitos.",
          });
          return;
        }
        setError("");
        onSubmit(draft);
      }}
    >
      <Field
        name="panel-management-code"
        label="Código do órgão"
        value={draft}
        required
        hint="Código de 5 dígitos no Portal da Transparência."
        error={error}
        onChange={(_, value) => setDraft(value)}
      />
      <Button className="button secondary" type="submit">
        Usar órgão
      </Button>
    </form>
  );
}
