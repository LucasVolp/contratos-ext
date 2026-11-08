"use client";
import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { validateFilters } from "@contracts/validation";
import { statusLabels } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { SearchField } from "@/components/ui/search-field";
import { Field } from "../ui";

export type ContractFilterValues = {
  search: string;
  status: string;
  uasg: string;
  from: string;
  to: string;
};
export const noContractFilters: ContractFilterValues = {
  search: "",
  status: "",
  uasg: "",
  from: "",
  to: "",
};

/** Search, situation, UASG and vigência filters of the contract list. */
export function ContractFilters({
  values,
  onChange,
  onClear,
}: {
  values: ContractFilterValues;
  onChange: (name: keyof ContractFilterValues, value: string) => void;
  onClear: () => void;
}) {
  const [advanced, setAdvanced] = useState(false);
  const errors = validateFilters(values);
  return (
    <>
      <div className="filters">
        <SearchField
          id="contract-search"
          label="Buscar contratos"
          placeholder="Buscar número, objeto ou fornecedor…"
          value={values.search}
          onChange={(e) => onChange("search", e.target.value)}
        />
        <div className="filter-field">
          <Label htmlFor="contract-status">Situação</Label>
          <NativeSelect
            id="contract-status"
            aria-label="Filtrar por situação"
            value={values.status}
            onChange={(e) => onChange("status", e.target.value)}
          >
            <NativeSelectOption value="">Todas as situações</NativeSelectOption>
            {Object.entries(statusLabels).map(([value, label]) => (
              <NativeSelectOption key={value} value={value}>
                {label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <Button
          type="button"
          variant="outline"
          className="filter-toggle"
          aria-expanded={advanced}
          onClick={() => setAdvanced(!advanced)}
        >
          <SlidersHorizontal size={16} aria-hidden="true" />
          Filtros
        </Button>
      </div>
      {advanced && (
        <div className="advanced-filters">
          <Field
            name="uasg"
            label="UASG"
            value={values.uasg}
            onChange={(_, value) => onChange("uasg", value)}
            error={errors.uasg}
          />
          <Field
            name="from"
            label="Vigência a partir de"
            type="date"
            value={values.from}
            onChange={(_, value) => onChange("from", value)}
            error={errors.from}
          />
          <Field
            name="to"
            label="Vigência até"
            type="date"
            value={values.to}
            onChange={(_, value) => onChange("to", value)}
            error={errors.to}
          />
          <Button type="button" variant="ghost" className="text-button" onClick={onClear}>
            Limpar filtros
          </Button>
        </div>
      )}
    </>
  );
}
