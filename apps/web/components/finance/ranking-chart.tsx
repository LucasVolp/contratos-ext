"use client";
import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { compactCurrency, currency } from "@/lib/api";
import { chartRatio, chartUnits } from "@/lib/decimal-display";
import type { ChartEntry } from "@/lib/finance-types";
export function RankingChart({
  items,
  onSelect,
  selected,
  emptyLabel = "Nenhum registro neste recorte.",
}: {
  items: ChartEntry[];
  onSelect?: (item: ChartEntry) => void;
  selected?: string;
  emptyLabel?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const sorted = [...items].sort((a, b) => {
    const x = chartUnits(a.value),
      y = chartUnits(b.value);
    return x === null
      ? y === null
        ? 0
        : 1
      : y === null
        ? -1
        : x === y
          ? 0
          : x > y
            ? -1
            : 1;
  });
  const maximum = sorted.reduce((max, r) => {
    const v = chartUnits(r.value) || BigInt(0);
    const abs = v < BigInt(0) ? -v : v;
    return abs > max ? abs : max;
  }, BigInt(0));
  const signed = sorted.some(
    (r) => (chartUnits(r.value) || BigInt(0)) < BigInt(0),
  );
  if (!items.length) return <p className="panel-no-data">{emptyLabel}</p>;
  return (
    <>
      <ul className="panel-ranking">
        {(expanded ? sorted : sorted.slice(0, 5)).map((item) => {
          const v = chartUnits(item.value);
          const width =
            (chartRatio(
              v === null ? BigInt(0) : v < BigInt(0) ? -v : v,
              maximum,
            ) *
              100) /
            (signed ? 2 : 1);
          const content = (
            <>
              <span className="ranking-heading">
                <span>
                  <strong>{item.name}</strong>
                  {item.caption && <small>{item.caption}</small>}
                </span>
                <span className="ranking-value" title={currency(item.value)}>
                  {compactCurrency(item.value)}
                  {onSelect && item.filterValue && (
                    <ArrowUpRight size={14} aria-hidden="true" />
                  )}
                </span>
              </span>
              <span
                className={`ranking-track${signed ? " signed" : ""}`}
                aria-hidden="true"
              >
                <span
                  className={`ranking-fill${v !== null && v < BigInt(0) ? " negative" : ""}`}
                  style={{
                    width: `${width}%`,
                    left: signed
                      ? v !== null && v < BigInt(0)
                        ? `${50 - width}%`
                        : "50%"
                      : "0",
                  }}
                />
              </span>
            </>
          );
          return (
            <li key={item.id}>
              {onSelect && item.filterValue ? (
                <button
                  type="button"
                  aria-pressed={selected === item.filterValue}
                  aria-label={`${item.name}: ${currency(item.value)}. Filtrar painel.`}
                  onClick={() => onSelect(item)}
                >
                  {content}
                </button>
              ) : (
                <div className="ranking-content">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
      {sorted.length > 5 && (
        <button
          className="panel-text-button"
          type="button"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Mostrar menos" : `Ver todos (${sorted.length})`}
        </button>
      )}
    </>
  );
}
