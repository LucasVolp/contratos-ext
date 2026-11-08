import { parseDecimal } from "@contracts/validation";
import { chartRatio, formatSourceDecimal } from "./decimal-display";
import type {
  ExecutionMetric,
  ExecutionNature,
  ExecutionSummary,
} from "./finance-types";

function decimal(value: string | null) {
  if (value === null) return null;
  const negative = value.startsWith("-");
  const absolute = negative ? value.slice(1) : value;
  const raw = parseDecimal(absolute) ?? absolute;
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  const [integer, fraction = ""] = raw.split(".");
  return {
    units: BigInt(integer + fraction) * BigInt(negative ? -1 : 1),
    places: fraction.length,
    scale: BigInt(10) ** BigInt(fraction.length),
  };
}
function sourceValue(units: bigint, places: number) {
  const negative = units < BigInt(0);
  const digits = String(negative ? -units : units).padStart(places + 1, "0");
  return `${negative ? "-" : ""}${places ? `${digits.slice(0, -places)}.${digits.slice(-places)}` : digits}`
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
}
export function expenseShare(value: string | null, total: string | null) {
  const part = decimal(value),
    all = decimal(total);
  if (!part || !all || all.units <= BigInt(0)) return null;
  const units =
    (part.units * all.scale * BigInt(10000)) / (all.units * part.scale);
  if (units === BigInt(0) && part.units > BigInt(0)) return "<0,01%";
  return `${formatSourceDecimal(sourceValue(units, 2))}%`;
}
export function rankExecutionNatures(
  natures: ExecutionNature[],
  metric: ExecutionMetric,
) {
  const known = natures.flatMap((node) => {
    const amount = decimal(node.summary[metric]);
    return amount ? [{ node, amount }] : [];
  });
  known.sort((a, b) => {
    const x = a.amount.units * b.amount.scale,
      y = b.amount.units * a.amount.scale;
    return x === y ? a.node.code.localeCompare(b.node.code) : x > y ? -1 : 1;
  });
  return {
    rows: known.slice(0, 5).map(({ node }) => node),
    missingCount: natures.length - known.length,
  };
}
export function executionComposition(summary: ExecutionSummary) {
  const raw = [
    summary.committedValue,
    summary.liquidatedValue,
    summary.paidValue,
  ].map(decimal);
  const empty = (status: "missing" | "inconsistent" | "zero") => ({
    status,
    parts: [] as {
      label: string;
      tone: string;
      value: string;
      coordinate: number;
      percent: string | null;
    }[],
  });
  if (raw.some((value) => value === null)) return empty("missing");
  const places = Math.max(...raw.map((value) => value!.places));
  const [e, l, p] = raw.map(
    (value) => value!.units * BigInt(10) ** BigInt(places - value!.places),
  );
  if (e < l || l < p || p < BigInt(0)) return empty("inconsistent");
  if (e === BigInt(0)) return empty("zero");
  const values = [p, l - p, e - l];
  const labels = ["Pago", "Liquidado a pagar", "Empenhado a liquidar"];
  const tones = ["paid", "committed", "liquidated"];
  return {
    status: "ready" as const,
    parts: values.map((units, index) => {
      const value = sourceValue(units, places);
      return {
        label: labels[index],
        tone: tones[index],
        value,
        coordinate: chartRatio(units, e),
        percent: expenseShare(value, summary.committedValue),
      };
    }),
  };
}

export function expenseBarData(
  slices: { label: string; value: string | null }[],
  total: string | null,
) {
  const parsed = slices.map((slice) => ({
    ...slice,
    amount: decimal(slice.value),
  }));
  const places = Math.max(
    0,
    ...parsed.map((slice) => slice.amount?.places || 0),
  );
  const values = parsed.map((slice) =>
    slice.amount
      ? slice.amount.units * BigInt(10) ** BigInt(places - slice.amount.places)
      : null,
  );
  const maximum = values.reduce<bigint>((max, value) => {
    const absolute =
      value === null ? BigInt(0) : value < BigInt(0) ? -value : value;
    return absolute > max ? absolute : max;
  }, BigInt(0));
  return {
    signed: values.some((value) => value !== null && value < BigInt(0)),
    rows: parsed.map((slice, index) => {
      const value = values[index];
      return {
        label: slice.label,
        value: slice.value,
        negative: value !== null && value < BigInt(0),
        width:
          value === null
            ? null
            : chartRatio(value < BigInt(0) ? -value : value, maximum) * 100,
        percent: expenseShare(slice.value, total),
      };
    }),
  };
}
