import { test, expect } from "@playwright/test";
import { interpretScopeSearch } from "../../apps/web/lib/finance-scope-search";

const units = [
  { code: "158454", name: "IFMS - Campus Três Lagoas" },
  { code: "158148", name: "IFMS - Reitoria" },
  { code: "000001", name: "Campus Três Rios" },
  { code: "000002", name: "Campus Lagoas do Norte" },
];

test("scope search resolves the city, fiscal year and month regardless of order or accents", () => {
  for (const text of [
    "tres lagoas 2024 janeiro",
    "janeiro 2024 Três Lagoas",
    "2024 jan tres lagoas",
  ]) {
    expect(interpretScopeSearch(text, units)).toEqual({
      changes: {
        managementUnitCode: "158454",
        fiscalYear: "2024",
        fromMonth: "1",
        toMonth: "1",
      },
      labels: ["IFMS - Campus Três Lagoas", "Exercício 2024", "Janeiro"],
      unmatched: [],
      candidates: [],
    });
  }
});

test("scope search never suggests a unit from only part of a recognized city name", () => {
  const missing = interpretScopeSearch("tres lagoas 2024 janeiro", [
    { code: "000001", name: "Campus Três Rios" },
    { code: "000002", name: "Campus Lagoas do Norte" },
    { code: "000003", name: "Campus Três Rios - Unidade Central" },
  ]);
  expect(missing.changes).toEqual({ fiscalYear: "2024", fromMonth: "1", toMonth: "1" });
  expect(missing.candidates).toEqual([]);
  expect(missing.unmatched).toEqual(["tres", "lagoas"]);
});

test("scope search keeps homonymous units as choices", () => {
  const homonyms = [
    units[0],
    { code: "000004", name: "Universidade - Campus Três Lagoas" },
  ];
  const result = interpretScopeSearch("tres lagoas 2024 janeiro", homonyms);
  expect(result.changes).toEqual({ fiscalYear: "2024", fromMonth: "1", toMonth: "1" });
  expect(result.candidates).toEqual(homonyms);
});
