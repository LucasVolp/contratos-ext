"use client";
import { currency } from "@/lib/api";
import { expenseBarData } from "@/lib/finance-chart";
import type { ExecutionMetric } from "@/lib/finance-types";

export function ExpenseBars({
  slices,
  total,
  metric,
}: {
  slices: { label: string; value: string | null }[];
  total: string | null;
  metric: ExecutionMetric;
}) {
  const chart = expenseBarData(slices, total);
  return (
    <figure
      className="expense-bars"
      data-signed={chart.signed}
      data-metric={metric}
      aria-label="Distribuição do gasto por subelemento"
    >
      <ol>
        {chart.rows.map((row) => (
          <li key={row.label}>
            <div className="expense-bar-heading">
              <span title={row.label}>{row.label}</span>
              <div>
                <strong className="expense-bar-value">
                  {currency(row.value)}
                </strong>
                {row.percent ? <small>{row.percent}</small> : null}
              </div>
            </div>
            {row.width !== null ? (
              <div className="expense-bar-track" aria-hidden="true">
                <span
                  className={`expense-bar-fill ${row.negative ? "is-negative" : ""}`}
                  style={{
                    width: `${chart.signed ? row.width / 2 : row.width}%`,
                  }}
                />
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </figure>
  );
}
