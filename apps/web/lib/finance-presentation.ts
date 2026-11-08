import type { ExecutionAmounts, ExecutionMetric } from "./finance-types";

export const executionStages: {
  key: ExecutionMetric;
  label: string;
  tone: string;
}[] = [
  { key: "committedValue", label: "Empenhado", tone: "committed" },
  { key: "liquidatedValue", label: "Liquidado", tone: "liquidated" },
  { key: "paidValue", label: "Pago", tone: "paid" },
];

export function natureCode(value: string) {
  return /^(?:\d{6}|\d{8})$/.test(value)
    ? `${value[0]}.${value[1]}.${value.slice(2, 4)}.${value.slice(4, 6)}${value.length === 8 ? `.${value.slice(6)}` : ""}`
    : value;
}

export const executionColumns: {
  key: keyof ExecutionAmounts;
  label: string;
  tone: string;
}[] = [
  ...executionStages,
  { key: "priorYearPaidValue", label: "R.P.", tone: "payables" },
];
