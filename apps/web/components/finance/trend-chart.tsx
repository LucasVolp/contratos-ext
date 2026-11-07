import { currency } from "@/lib/api";
import { chartRatio, chartUnits, compactMoney } from "@/lib/decimal-display";
import type { ExecutionBreakdowns } from "@/lib/finance-types";
export const executionStages = [
  { key: "committedValue", label: "Empenhado", tone: "committed" },
  { key: "liquidatedValue", label: "Liquidado", tone: "liquidated" },
  { key: "paidValue", label: "Pago", tone: "paid" },
] as const;
const monthLabel = (month: number) =>
  [
    "Jan",
    "Fev",
    "Mar",
    "Abr",
    "Mai",
    "Jun",
    "Jul",
    "Ago",
    "Set",
    "Out",
    "Nov",
    "Dez",
  ][month - 1];
export function TrendChart({ rows }: { rows: ExecutionBreakdowns["monthly"] }) {
  const values = rows.flatMap((row) =>
    row.summary.sourceRowCount
      ? executionStages
          .map((s) => chartUnits(row.summary[s.key]))
          .filter((v): v is bigint => v !== null)
      : [],
  );
  const minimum = values.reduce((a, b) => (b < a ? b : a), BigInt(0));
  const maximum = values.reduce((a, b) => (b > a ? b : a), BigInt(0));
  const span = maximum - minimum || BigInt(1);
  const x = (index: number) =>
    75 + index * (595 / Math.max(1, rows.length - 1));
  const y = (value: bigint) => 205 - chartRatio(value - minimum, span) * 165;
  const axisLabel = (value: bigint) => {
    const absolute = value < BigInt(0) ? -value : value;
    const decimal = `${value < BigInt(0) ? "-" : ""}${absolute / BigInt(1000000)}.${String(absolute % BigInt(1000000)).padStart(6, "0")}`;
    return compactMoney(decimal).replace("R$ ", "").replace(",00", "");
  };
  const ticks = [
    ...new Set(
      Array.from(
        { length: 4 },
        (_, index) => minimum + (span * BigInt(index)) / BigInt(3),
      ),
    ),
  ];
  return (
    <>
      <div className="panel-chart-legend">
        {executionStages.map((s) => (
          <span key={s.key}>
            <i className={s.tone} />
            {s.label}
          </span>
        ))}
      </div>
      <div className="panel-trend">
        <svg
          viewBox="0 0 710 255"
          role="img"
          aria-label="Evolução mensal dos valores empenhados, liquidados e pagos"
        >
          <title>
            Execução mensal em reais. Meses sem registros aparecem como lacunas.
          </title>
          {ticks.map((v, i) => {
            return (
              <g key={i}>
                <line
                  className="chart-grid"
                  x1="75"
                  x2="670"
                  y1={y(v)}
                  y2={y(v)}
                />
                <text
                  x="64"
                  y={y(v) + 4}
                  textAnchor="end"
                  className="chart-tick"
                >
                  {axisLabel(v)}
                </text>
              </g>
            );
          })}
          {executionStages.map((s) => {
            let path = "";
            let connected = false;
            rows.forEach((row, i) => {
              const v = row.summary.sourceRowCount
                ? chartUnits(row.summary[s.key])
                : null;
              if (v === null) {
                connected = false;
                return;
              }
              path += `${connected ? "L" : "M"}${x(i)},${y(v)} `;
              connected = true;
            });
            return (
              <g className={`chart-series ${s.tone}`} key={s.key}>
                <path d={path} />
                {rows.map((row, i) => {
                  const v = row.summary.sourceRowCount
                    ? chartUnits(row.summary[s.key])
                    : null;
                  return v === null ? null : (
                    <circle key={row.month} cx={x(i)} cy={y(v)} r="4">
                      <title>
                        {monthLabel(row.month)}: {s.label}{" "}
                        {currency(row.summary[s.key])}
                      </title>
                    </circle>
                  );
                })}
              </g>
            );
          })}
          {rows.map((row, i) => (
            <text
              key={row.month}
              x={x(i)}
              y="235"
              textAnchor="middle"
              className="chart-tick"
            >
              {monthLabel(row.month)}
            </text>
          ))}
        </svg>
      </div>
      <details className="panel-chart-values">
        <summary>Ver valores mensais</summary>
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Valores mensais"
        >
          <table>
            <caption className="sr-only">
              Valores mensais da execução financeira
            </caption>
            <thead>
              <tr>
                <th>Mês</th>
                {executionStages.map((s) => (
                  <th key={s.key}>{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.month}>
                  <th scope="row">{monthLabel(row.month)}</th>
                  {executionStages.map((s) => (
                    <td key={s.key}>
                      {row.summary.sourceRowCount
                        ? currency(row.summary[s.key])
                        : "Sem registros"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className="panel-footnote">
        Meses sem registros não são tratados como valor zero.
      </p>
    </>
  );
}
