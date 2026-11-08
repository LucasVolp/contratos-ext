"use client";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

import { RefreshCw } from "lucide-react";
import type { FinanceUnit } from "@/lib/finance-types";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { financeInstitutionLabel } from "@/lib/finance-institution-label";
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
  showScopeFilters = true,
}: {
  scope: PanelScope;
  units: ScopeChoice[];
  agencies: FinanceUnit[];
  onChange: (changes: Record<string, string>) => void;
  onRefresh: () => void;
  busy: boolean;
  budget?: boolean;
  showPeriod?: boolean;
  showScopeFilters?: boolean;
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
      <div className="panel-institution-select">
        <Label htmlFor="panel-agency">Instituição</Label>
        <NativeSelect
          id="panel-agency"
          className="panel-institution-options"
          size="sm"
          value={scope.managementCode}
          disabled={organizations.length === 0}
          title={organizations.find((organization) => organization.code === scope.managementCode)?.name || scope.managementCode}
          onChange={(event) =>
            onChange({
              [budget ? "subordinateAgencyCode" : "managementCode"]:
                event.target.value,
              managementUnitCode: "",
              budgetaryUnitCode: "",
            })
          }
        >
          {!organizations.some((organization) => organization.code === scope.managementCode) ? (
            <NativeSelectOption value={scope.managementCode}>
              {scope.managementCode || "Nenhuma instituição disponível"}
            </NativeSelectOption>
          ) : null}
          {organizations.map((organization) => (
            <NativeSelectOption key={organization.code} value={organization.code}>
              {financeInstitutionLabel(organization.code, organization.name)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className="panel-primary-filters">
        {showScopeFilters ? (
          <>
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
          </>
        ) : null}
        <Button
          className="button secondary panel-refresh"
          type="button"
          onClick={onRefresh}
          disabled={busy || !scope.managementCode}
          aria-label={busy ? "Consultando painel" : "Atualizar painel"}
          title={busy ? "Consultando painel" : "Atualizar painel"}
        >
          <RefreshCw size={15} aria-hidden="true" />
        </Button>
      </div>
    </section>
  );
}
