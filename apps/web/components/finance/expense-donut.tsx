"use client";
import { Pie, PieChart, Tooltip } from "recharts";
import { ChartContainer } from "@/components/ui/chart";
import { currency } from "@/lib/api";
import { compactMoney } from "@/lib/decimal-display";
export interface DonutPart {
  label: string;
  tone: string;
  value: string;
  coordinate: number;
  percent: string | null;
}
const tones: Record<string, string> = {
  paid: "var(--chart-paid)",
  committed: "var(--chart-committed)",
  liquidated: "var(--chart-liquidated)",
  primary: "var(--green)",
  accent: "var(--accent)",
  other: "var(--muted)",
};
export function ExpenseDonut({
  parts: source,
  total,
  totalLabel,
  label,
}: {
  parts: DonutPart[];
  total: string | null;
  totalLabel: string;
  label: string;
}) {
  const parts = source.map((part) => ({
    ...part,
    fill: tones[part.tone] || tones.other,
  }));
  return (
    <>
      <div className="execution-donut-plot">
        <ChartContainer
          role="img"
          aria-label={label}
          className="execution-donut"
        >
          <PieChart accessibilityLayer>
            <Pie
              data={parts}
              dataKey="coordinate"
              nameKey="label"
              innerRadius="68%"
              outerRadius="92%"
              stroke="var(--paper)"
              strokeWidth={3}
              isAnimationActive={false}
            ></Pie>
            <Tooltip
              content={({ active, payload }) => {
                const part = parts.find(
                  (row) => row.label === payload?.[0]?.name,
                );
                return active && part ? (
                  <div className="execution-chart-tooltip">
                    <strong>{part.label}</strong>
                    <p>
                      {currency(part.value)} · {part.percent}
                    </p>
                  </div>
                ) : null;
              }}
            />
          </PieChart>
        </ChartContainer>
        <div className="execution-donut-center" aria-hidden="true">
          <span>{totalLabel}</span>
          <strong title={currency(total)}>{compactMoney(total)}</strong>
        </div>
      </div>
      <dl className="execution-donut-legend">
        {parts.map((part) => (
          <div key={part.label} className={part.tone}>
            <dt>
              <i aria-hidden="true" />
              {part.label}
            </dt>
            <dd>
              <strong>{currency(part.value)}</strong>
              <span>{part.percent}</span>
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}
