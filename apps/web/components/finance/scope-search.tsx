"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import {
  interpretScopeSearch,
  scopeSearchUnitLabel,
  type ScopeSearchResult,
  type ScopeSearchUnit,
} from "@/lib/finance-scope-search";

const EXAMPLE = "Ex.: tres lagoas 2024 janeiro";

function describe(result: ScopeSearchResult) {
  return result.labels.join(" · ");
}

function previewText(result: ScopeSearchResult | null, periods: boolean) {
  if (!result)
    return periods
      ? "Digite a unidade, o exercício ou o período."
      : "Digite a unidade ou o exercício.";
  const pending =
    result.candidates.length > 0 ? "mais de uma unidade corresponde" : "";
  if (result.labels.length > 0)
    return `Entendi: ${describe(result)}${pending ? ` · ${pending}` : ""}.`;
  if (pending) return "Mais de uma unidade corresponde à busca.";
  return periods
    ? "Nenhuma unidade, exercício ou período reconhecido."
    : "Nenhuma unidade ou exercício reconhecido.";
}

export function ScopeSearch({
  units,
  unitKey,
  periods,
  onApply,
  currentScope,
}: {
  units: ScopeSearchUnit[];
  unitKey: string;
  periods: boolean;
  onApply: (changes: Record<string, string>) => void;
  currentScope?: string;
}) {
  const [draft, setDraft] = useState("");
  const [outcome, setOutcome] = useState<ScopeSearchResult | null>(null);
  const read = (text: string) =>
    interpretScopeSearch(text, units, { unitKey, periods });
  const hint = outcome?.candidates.length
    ? "Escolha a unidade abaixo."
    : previewText(draft.trim() ? read(draft) : null, periods);
  function apply(text: string) {
    const result = read(text);
    setOutcome(result);
    if (Object.keys(result.changes).length > 0) onApply(result.changes);
    if (result.labels.length > 0 && result.candidates.length === 0)
      setDraft("");
  }
  function choose(unit: ScopeSearchUnit) {
    onApply({ [unitKey]: unit.code });
    setOutcome({
      changes: { [unitKey]: unit.code },
      labels: [scopeSearchUnitLabel(unit), ...(outcome?.labels || [])],
      unmatched: outcome?.unmatched || [],
      candidates: [],
    });
    setDraft("");
  }
  return (
    <div className="scope-search">
      <form
        className="scope-search-form"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.trim()) apply(draft);
        }}
      >
        <SearchField
          id="scope-search"
          label="Buscar recorte"
          value={draft}
          placeholder={EXAMPLE}
          autoComplete="off"
          aria-describedby="scope-search-hint"
          onChange={(event) => {
            setDraft(event.target.value);
            setOutcome(null);
          }}
        />
        <Button
          className="button secondary"
          type="submit"
          disabled={!draft.trim()}
        >
          Aplicar
        </Button>
        <p
          id="scope-search-hint"
          className="scope-search-preview muted"
          title={hint}
        >
          {hint}
        </p>
      </form>
      {currentScope ? (
        <p className="muted" aria-label="Recorte atual" aria-live="polite">
          {currentScope}
        </p>
      ) : null}
      <div role="status" className="scope-search-outcome">
        {outcome ? <Outcome result={outcome} onChoose={choose} /> : null}
      </div>
    </div>
  );
}

function Outcome({
  result,
  onChoose,
}: {
  result: ScopeSearchResult;
  onChoose: (unit: ScopeSearchUnit) => void;
}) {
  return (
    <>
      {result.labels.length > 0 ? (
        <p>Aplicado: {describe(result)}.</p>
      ) : null}
      {result.unmatched.length > 0 ? (
        <p>Não reconheci: {result.unmatched.join(", ")}.</p>
      ) : null}
      {result.labels.length === 0 &&
      result.unmatched.length === 0 &&
      result.candidates.length === 0 ? (
        <p>Nenhum filtro reconhecido. {EXAMPLE}.</p>
      ) : null}
      {result.candidates.length > 0 ? (
        <div className="scope-search-candidates">
          <p>Mais de uma unidade corresponde. Escolha uma:</p>
          <ul>
            {result.candidates.slice(0, 6).map((unit) => (
              <li key={unit.code}>
                <Button
                  className="button secondary"
                  type="button"
                  onClick={() => onChoose(unit)}
                >
                  Usar {scopeSearchUnitLabel(unit)}
                </Button>
              </li>
            ))}
          </ul>
          {result.candidates.length > 6 ? (
            <p className="muted">
              Outras {result.candidates.length - 6} unidades correspondem.
              Refine a busca.
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
