import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFacts, FactInput, FactTerm } from "../src/contracts/facts";

const TODAY = "2026-05-07";

function term(fields: Partial<FactTerm> & { externalId: string; typeName: string }): FactTerm {
  return {
    number: null,
    qualifications: [],
    observation: null,
    signatureDate: null,
    startDate: null,
    endDate: null,
    globalValue: null,
    ...fields,
  };
}

function input(overrides: { header?: Partial<FactInput["header"]> } & Partial<Omit<FactInput, "header">> = {}): FactInput {
  return {
    history: [],
    guarantees: [],
    parts: { history: "AVAILABLE", guarantees: "AVAILABLE" },
    ...overrides,
    header: {
      typeName: "Contrato",
      category: "Serviços",
      legalBasis: null,
      signatureDate: null,
      startDate: null,
      endDate: null,
      initialValue: null,
      ...overrides.header,
    },
  };
}

test("header end date wins and shows a later term as divergence", () => {
  const facts = computeFacts(
    input({
      header: { endDate: "2026-06-06" },
      history: [
        term({ externalId: "1", typeName: "Contrato", signatureDate: "2021-12-06", endDate: "2024-06-06" }),
        term({ externalId: "2", typeName: "Termo Aditivo", number: "00001/2024", signatureDate: "2024-05-13", endDate: "2026-12-06" }),
      ],
    }),
    TODAY,
  );
  assert.deepEqual(facts.endDate, {
    value: "2026-06-06",
    source: "HEADER",
    daysLeft: 30,
    divergence: { termEndDate: "2026-12-06", termExternalId: "2", termNumber: "00001/2024" },
  });
});

test("end date falls back to the latest term", () => {
  const facts = computeFacts(
    input({
      history: [
        term({ externalId: "1", typeName: "Contrato", signatureDate: "2025-02-10" }),
        term({ externalId: "2", typeName: "Termo Aditivo", signatureDate: "2026-04-23", endDate: "2027-05-01" }),
      ],
    }),
    TODAY,
  );
  assert.equal(facts.endDate.value, "2027-05-01");
  assert.equal(facts.endDate.source, "TERM");
  assert.equal(facts.endDate.divergence, null);
});

test("rescission matching the header is not a divergence", () => {
  const facts = computeFacts(
    input({
      header: { endDate: "2025-08-22" },
      history: [
        term({ externalId: "1", typeName: "Contrato", signatureDate: "2024-12-17", endDate: "2025-12-17" }),
        term({ externalId: "2", typeName: "Termo de Rescisão", signatureDate: "2025-07-22", endDate: "2025-08-22" }),
      ],
    }),
    TODAY,
  );
  assert.equal(facts.endDate.value, "2025-08-22");
  assert.equal(facts.endDate.divergence, null);
  assert.equal(facts.endDate.daysLeft, -258);
});

test("an undated term never overrides dated terms for the end date", () => {
  const history = [
    term({ externalId: "1", typeName: "Contrato", endDate: "2022-12-01" }),
    term({ externalId: "2", typeName: "Termo Aditivo", signatureDate: "2022-05-01", endDate: "2026-12-01" }),
  ];
  const withHeader = computeFacts(input({ header: { endDate: "2026-12-01" }, history }), TODAY);
  assert.equal(withHeader.endDate.divergence, null);
  const withoutHeader = computeFacts(input({ history }), TODAY);
  assert.equal(withoutHeader.endDate.value, "2026-12-01");
  assert.equal(withoutHeader.endDate.source, "TERM");
  const undatedOnly = computeFacts(input({ history: [history[0]] }), TODAY);
  assert.equal(undatedOnly.endDate.value, "2022-12-01");
});

test("apostille end dates are ignored", () => {
  const facts = computeFacts(
    input({
      header: { endDate: "2026-04-30" },
      history: [
        term({ externalId: "1", typeName: "Termo Aditivo", signatureDate: "2025-03-28", endDate: "2026-04-30" }),
        term({ externalId: "2", typeName: "Termo de Apostilamento", signatureDate: "2025-05-27", endDate: "2026-10-30" }),
      ],
    }),
    TODAY,
  );
  assert.equal(facts.endDate.divergence, null);
});

test("law from legal basis or signature date", () => {
  const cases: [string | null, string | null, string, string][] = [
    ["LEI 14.133/2021 - Artigo: 74 - Inciso: IV", null, "14133", "LEGAL_BASIS"],
    ["Lei nº 8.666/1993", null, "8666", "LEGAL_BASIS"],
    [null, "2019-01-31", "8666", "SIGNATURE_DATE"],
    [null, "2022-06-01", "UNKNOWN", "SIGNATURE_DATE"],
    [null, "2024-01-02", "14133", "SIGNATURE_DATE"],
    [null, null, "UNKNOWN", "NONE"],
  ];
  for (const [legalBasis, signatureDate, law, lawSource] of cases) {
    const facts = computeFacts(input({ header: { legalBasis, signatureDate } }), TODAY);
    assert.deepEqual([facts.term.law, facts.term.lawSource], [law, lawSource], `${legalBasis} ${signatureDate}`);
  }
});

test("time in force against the legal maximum", () => {
  const base = { legalBasis: "Lei 14.133/2021", startDate: "2021-12-06", endDate: "2026-06-06" };
  let facts = computeFacts(input({ header: base }), TODAY);
  assert.equal(facts.term.status, "ESTIMATED");
  assert.equal(facts.term.startDate, "2021-12-06");
  assert.equal(facts.term.months, 54);
  assert.equal(facts.term.capMonths, 120);

  // The end date is the last day in force: 2021-12-06 to 2026-06-05 is 54 full months.
  facts = computeFacts(input({ header: { ...base, endDate: "2026-06-05" } }), TODAY);
  assert.equal(facts.term.months, 54);
  facts = computeFacts(input({ header: { ...base, endDate: "2026-06-04" } }), TODAY);
  assert.equal(facts.term.months, 53);
  facts = computeFacts(input({ header: { ...base, startDate: "2019-02-01", endDate: "2024-01-31" } }), TODAY);
  assert.equal(facts.term.months, 60);

  facts = computeFacts(input({ header: { ...base, category: "Compras" } }), TODAY);
  assert.equal(facts.term.status, "NOT_APPLICABLE");
  assert.equal(facts.term.months, null);

  facts = computeFacts(input({ header: { ...base, typeName: "Empenho" } }), TODAY);
  assert.equal(facts.term.status, "NOT_APPLICABLE");
  assert.equal(facts.amendments.status, "NOT_APPLICABLE");

  facts = computeFacts(input({ header: { ...base, legalBasis: null, signatureDate: "2022-06-01" } }), TODAY);
  assert.equal(facts.term.capMonths, null);

  facts = computeFacts(input({ header: { ...base, legalBasis: "Lei 8.666/93" } }), TODAY);
  assert.equal(facts.term.capMonths, 60);

  facts = computeFacts(input({ header: { ...base, startDate: null } }), TODAY);
  assert.equal(facts.term.status, "NOT_COMPUTABLE");
});

test("time in force starts at the original term", () => {
  const facts = computeFacts(
    input({
      header: { legalBasis: "Lei 14.133/2021", startDate: "2023-01-01", endDate: "2026-06-06" },
      history: [term({ externalId: "1", typeName: "Contrato", signatureDate: "2021-12-01", startDate: "2021-12-06" })],
    }),
    TODAY,
  );
  assert.equal(facts.term.startDate, "2021-12-06");
  assert.equal(facts.term.months, 54);
});

test("guarantee coverage", () => {
  const end = { endDate: "2026-06-06" };
  const g = (externalId: string, dueDate: string | null) => ({ externalId, dueDate });
  const cases: [Partial<FactInput>, string, string | null, number | null][] = [
    [{ guarantees: [g("1", "2025-01-01"), g("2", "2027-01-01")] }, "COVERS", "2027-01-01", null],
    [{ guarantees: [g("1", "2026-05-30")] }, "BEFORE_END", "2026-05-30", 7],
    [{ parts: { history: "AVAILABLE", guarantees: "NOT_FOUND" } }, "NONE_INFORMED", null, null],
    [{ parts: { history: "AVAILABLE", guarantees: "AVAILABLE" } }, "NONE_INFORMED", null, null],
    [{ parts: { history: "AVAILABLE", guarantees: "MISSING" } }, "NOT_CONSULTED", null, null],
    [{ parts: { history: "AVAILABLE", guarantees: "FAILED" } }, "NOT_CONSULTED", null, null],
    [{ guarantees: [g("1", null)] }, "NO_DUE_DATE", null, null],
  ];
  for (const [overrides, status, dueDate, daysBeforeEnd] of cases) {
    const facts = computeFacts(input({ ...overrides, header: end }), TODAY);
    assert.deepEqual(
      [facts.guarantee.status, facts.guarantee.dueDate, facts.guarantee.daysBeforeEnd],
      [status, dueDate, daysBeforeEnd],
      JSON.stringify(overrides),
    );
  }
  const noEnd = computeFacts(input({ guarantees: [g("1", "2026-05-30")] }), TODAY);
  assert.equal(noEnd.guarantee.status, "NOT_COMPARABLE");
  assert.equal(noEnd.guarantee.count, 1);
});

const AS = "ACRÉSCIMO / SUPRESSÃO";
const contractWith = (initialValue: string | null, history: FactTerm[]) =>
  computeFacts(input({ header: { initialValue }, history }), TODAY);
const outcome = (t: { counted: string | null; reason: string | null; flags: string[] }) => [t.counted ?? t.reason, ...t.flags];

test("amendments: when in doubt, count", () => {
  const facts = contractWith("100000", [
    term({ externalId: "1", typeName: "Contrato", signatureDate: "2021-01-01", globalValue: "100000" }),
    term({ externalId: "2", typeName: "Termo de Apostilamento", signatureDate: "2022-01-01", globalValue: "110000", observation: "ACRÉSCIMO DE R$ 10.000,00" }),
    term({ externalId: "3", typeName: "Termo Aditivo", signatureDate: "2022-06-01", globalValue: "130000", qualifications: [AS] }),
    term({ externalId: "4", typeName: "Termo Aditivo", signatureDate: "2023-01-01", globalValue: "125000", qualifications: [AS, "INFORMATIVO", "VIGÊNCIA"] }),
    term({ externalId: "5", typeName: "Termo Aditivo", signatureDate: "2024-01-01", globalValue: "125000", qualifications: ["VIGÊNCIA"] }),
    term({ externalId: "6", typeName: "Termo Aditivo", signatureDate: "2025-01-01", globalValue: "131250", qualifications: ["REAJUSTE", "VIGÊNCIA"] }),
    term({ externalId: "7", typeName: "Termo Aditivo", signatureDate: "2025-06-01", globalValue: "133250", observation: "REPACTUAÇÃO CONFORME CCT" }),
  ]);
  const a = facts.amendments;
  assert.equal(a.status, "ESTIMATED");
  assert.equal(a.base, "100000");
  assert.equal(a.additions, "22000.00");
  assert.equal(a.suppressions, "5000.00");
  assert.equal(a.additionsPct, "22.0000");
  assert.equal(a.suppressionsPct, "5.0000");
  assert.equal(a.margin, "3000.00");
  assert.equal(a.limitUsedRatio, "0.8800");
  assert.equal(a.nearLimit, true);
  assert.deepEqual(a.terms.map(outcome), [
    ["ORIGINAL"],
    ["APOSTILLE", "APOSTILLE_TEXT_MENTIONS_ADDITION"],
    ["ADDITION"],
    ["SUPPRESSION", "MIGRATED_RECORD"],
    ["NO_VALUE_CHANGE"],
    ["PRICE_ADJUSTMENT_ONLY"],
    ["ADDITION", "NO_QUALIFICATION", "TEXT_MENTIONS_ADJUSTMENT"],
  ]);
  assert.deepEqual(a.terms.map((t) => t.delta), [null, null, "20000.00", "-5000.00", "0.00", "6250.00", "2000.00"]);
});

test("amendments: migrated extensions without value change count nothing", () => {
  const migrated = [AS, "INFORMATIVO", "VIGÊNCIA"];
  const facts = contractWith("71352.36", [
    term({ externalId: "10", typeName: "Contrato", signatureDate: "2015-11-06", globalValue: "71352.36" }),
    ...[2016, 2017, 2018, 2019].map((year, i) =>
      term({ externalId: String(11 + i), typeName: "Termo Aditivo", signatureDate: `${year}-10-04`, globalValue: "71352.36", qualifications: migrated }),
    ),
  ]);
  assert.equal(facts.amendments.status, "ESTIMATED");
  assert.equal(facts.amendments.additionsPct, "0.0000");
  assert.equal(facts.amendments.nearLimit, false);
  assert.deepEqual(facts.amendments.terms.slice(1).map((t) => t.reason), Array(4).fill("NO_VALUE_CHANGE"));
});

test("amendments: over the limit gives a negative margin", () => {
  const facts = contractWith("100000", [
    term({ externalId: "1", typeName: "Contrato", signatureDate: "2021-01-01", globalValue: "100000" }),
    term({ externalId: "2", typeName: "Termo Aditivo", signatureDate: "2022-01-01", globalValue: "130000", qualifications: [AS] }),
  ]);
  assert.equal(facts.amendments.margin, "-5000.00");
  assert.equal(facts.amendments.limitUsedRatio, "1.2000");
});

test("amendments: a term without value keeps the reference", () => {
  const facts = contractWith("100000", [
    term({ externalId: "1", typeName: "Termo Aditivo", signatureDate: "2022-01-01", globalValue: "110000", qualifications: [AS] }),
    term({ externalId: "2", typeName: "Termo Aditivo", signatureDate: "2023-01-01", globalValue: null, qualifications: [AS] }),
    term({ externalId: "3", typeName: "Termo Aditivo", signatureDate: "2024-01-01", globalValue: "120000", qualifications: [AS] }),
  ]);
  assert.deepEqual(facts.amendments.terms.map(outcome), [["ADDITION"], ["NO_GLOBAL_VALUE"], ["ADDITION"]]);
  assert.equal(facts.amendments.terms[2].delta, "10000.00");
  assert.equal(facts.amendments.additions, "20000.00");
});

test("amendments: not computable without history or base", () => {
  const history = [term({ externalId: "1", typeName: "Contrato", globalValue: "100" })];
  assert.equal(contractWith("100", []).amendments.status, "NOT_COMPUTABLE");
  assert.equal(contractWith("0", history).amendments.status, "NOT_COMPUTABLE");
  assert.equal(contractWith(null, history).amendments.status, "NOT_COMPUTABLE");
  assert.equal(contractWith("0", history).amendments.additionsPct, null);
});

test("amendments: rows without signature date go last", () => {
  const facts = contractWith("100", [
    term({ externalId: "9", typeName: "Termo Aditivo", globalValue: "100" }),
    term({ externalId: "12", typeName: "Termo Aditivo", signatureDate: "2022-01-01", globalValue: "100" }),
    term({ externalId: "3", typeName: "Termo Aditivo", signatureDate: "2022-01-01", globalValue: "100" }),
  ]);
  assert.deepEqual(facts.amendments.terms.map((t) => t.externalId), ["3", "12", "9"]);
});

test("amendments: other instrument rows only move the reference", () => {
  const facts = contractWith("100", [
    term({ externalId: "1", typeName: "Contrato", signatureDate: "2021-01-01", globalValue: "100" }),
    term({ externalId: "2", typeName: "Outros", signatureDate: "2021-06-01", globalValue: "120" }),
    term({ externalId: "3", typeName: "Termo de Rescisão", signatureDate: "2022-01-01", globalValue: "120" }),
  ]);
  assert.deepEqual(facts.amendments.terms.map(outcome), [["ORIGINAL"], ["OTHER_TYPE"], ["RESCISSION"]]);
  assert.equal(facts.amendments.additions, "0.00");
});
