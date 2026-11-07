"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { loadFinanceUnits } from "@/lib/finance-api";
import type { FinanceUnit } from "@/lib/finance-types";
import { useFinanceQuery } from "./use-finance-query";
export function usePanelScope(
  kind: "execution" | "budgets" | "commitments" = "execution",
) {
  const budget = kind === "budgets";
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const directory = useFinanceQuery<FinanceUnit[]>(
    "financial-units",
    loadFinanceUnits,
  );
  const codeKey = budget ? "subordinateAgencyCode" : "managementCode",
    unitKey = budget ? "budgetaryUnitCode" : "managementUnitCode";
  const unit = params.get(unitKey) || "";
  const managementCode =
    params.get(codeKey) ||
    params.get("managementCode") ||
    directory.data?.find((u) => u.code === unit)?.managementCode ||
    directory.data?.[0]?.managementCode ||
    "";
  const fiscalYear =
    params.get("fiscalYear") || String(new Date().getFullYear());
  const scope = {
    managementCode,
    fiscalYear,
    unit,
    fromMonth: params.get("fromMonth") || "1",
    toMonth: params.get("toMonth") || "12",
  };
  const query = new URLSearchParams({ [codeKey]: managementCode, fiscalYear });
  const fields =
    kind === "commitments"
      ? [
          "managementUnitCode",
          "expenseNature",
          "favoredCode",
          "search",
          "from",
          "to",
        ]
      : budget
        ? [
            "budgetaryUnitCode",
            "actionCode",
            "economicCategoryCode",
            "expenseGroupCode",
            "expenseElementCode",
          ]
        : [
            "managementUnitCode",
            "expenseNature",
            "actionCode",
            "fromMonth",
            "toMonth",
          ];
  for (const field of fields) {
    const value = params.get(field);
    if (value) query.set(field, value);
  }
  function change(changes: Record<string, string>) {
    const next = new URLSearchParams(query);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete("page");
    router.push(`${pathname}?${next}`, { scroll: false });
  }
  const units = (directory.data || []).filter(
    (u) => u.managementCode === managementCode,
  );
  return {
    scope,
    query: query.toString(),
    urlQuery: params.toString(),
    directory,
    units,
    change,
    selectedNature: params.get("expenseNature"),
    selectedAction: params.get("actionCode"),
    selectedGroup: params.get("expenseGroupCode"),
  };
}
