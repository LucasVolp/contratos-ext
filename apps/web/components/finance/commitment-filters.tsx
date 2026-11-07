"use client";
import { Button } from "@/components/ui/button";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Field, FormValidation, focusInvalid } from "@/components/ui";
import { ApiError } from "@/lib/api";
export function CommitmentFilters({
  query,
  onChange,
  error,
}: {
  query: string;
  onChange: (values: Record<string, string>) => void;
  error?: Error;
}) {
  useEffect(() => {
    if (error instanceof ApiError && error.status === 400)
      focusInvalid(error.fieldErrors);
  }, [error]);
  const params = new URLSearchParams(query);
  const [values, setValues] = useState(
    Object.fromEntries(
      ["search", "expenseNature", "favoredCode", "from", "to"].map((key) => [
        key,
        params.get(key) || "",
      ]),
    ),
  );
  const update = (name: string, value: string) =>
    setValues((previous) => ({ ...previous, [name]: value }));
  return (
    <FormValidation.Provider
      value={{ errors: error instanceof ApiError ? error.fieldErrors : {} }}
    >
      <form
        className="panel-search-form"
        onSubmit={(event) => {
          event.preventDefault();
          onChange(values);
        }}
      >
        <div className="panel-search-primary">
          <Field
            name="search"
            label="Buscar empenhos"
            hint="Documento, favorecido ou número do processo."
            value={values.search}
            onChange={update}
          />
          <Button className="button" type="submit">
            <Search size={15} aria-hidden="true" />
            Buscar
          </Button>
        </div>
        <details className="panel-search-advanced">
          <summary>Filtros adicionais</summary>
          <div className="form-grid">
            <Field
              name="expenseNature"
              label="Natureza de despesa"
              hint="6 ou 8 dígitos."
              value={values.expenseNature}
              onChange={update}
            />
            <Field
              name="favoredCode"
              label="Código do favorecido"
              value={values.favoredCode}
              onChange={update}
            />
            <Field
              name="from"
              label="Emissão a partir de"
              type="date"
              value={values.from}
              onChange={update}
            />
            <Field
              name="to"
              label="Emissão até"
              type="date"
              value={values.to}
              onChange={update}
            />
          </div>
          <Button className="button secondary" type="submit">
            Aplicar filtros
          </Button>
          <p className="panel-footnote">
            A natureza seleciona empenhos completos. Os valores incluem todos os
            itens e movimentos de cada documento.
          </p>
        </details>
      </form>
    </FormValidation.Provider>
  );
}
