import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contractStatus,
  overlaps,
  validateRecord,
  recordTotal,
  readiness,
} from "../src/domain";

test("calendar statuses honor inclusive end and 30-day boundary", () => {
  const today = new Date("2026-10-30T23:59:59Z");
  assert.equal(
    contractStatus({ startDate: "2026-10-31", endDate: "2026-12-30" }, today),
    "UPCOMING",
  );
  assert.equal(
    contractStatus({ startDate: "2026-01-01", endDate: "2026-10-30" }, today),
    "EXPIRING",
  );
  assert.equal(
    contractStatus({ startDate: null, endDate: null }, today),
    "UNKNOWN",
  );
  assert.equal(
    contractStatus({ startDate: "2026-01-01", endDate: "2026-11-29" }, today),
    "EXPIRING",
  );
  assert.equal(
    contractStatus({ startDate: "2026-01-01", endDate: "2026-11-30" }, today),
    "ACTIVE",
  );
  assert.equal(
    contractStatus({ startDate: "2026-01-01", endDate: "2026-10-29" }, today),
    "EXPIRED",
  );
});
test("period intersection includes equal dates and excludes unknown dates", () => {
  assert.equal(
    overlaps(
      { startDate: "2026-01-01", endDate: "2026-02-01" },
      "2026-02-01",
      "2026-03-01",
    ),
    true,
  );
  assert.equal(
    overlaps({ startDate: null, endDate: null }, "2026-02-01"),
    false,
  );
});
const item = {
  number: 1,
  description: "Produto",
  unit: "UN",
  quantity: "0.1",
  minimumQuantity: "0",
  unitPrice: "0.2",
};
test("record totals use decimal arithmetic", () => {
  assert.equal(
    recordTotal({
      items: [item, { ...item, number: 2, quantity: "3", unitPrice: "0.1" }],
    }),
    "0.32",
  );
});
test("record accepts a draft but rejects duplicate items and minimum greater than quantity", () => {
  assert.equal(
    validateRecord({ number: "1", object: "Objeto", uasg: "000001" }).items
      .length,
    0,
  );
  assert.throws(
    () =>
      validateRecord({
        number: "1",
        object: "Objeto",
        uasg: "000001",
        items: [item, item],
      }),
    /único/,
  );
  assert.throws(
    () =>
      validateRecord({
        number: "1",
        object: "Objeto",
        uasg: "000001",
        items: [{ ...item, minimumQuantity: "2" }],
      }),
    /mínima/,
  );
});
test("readiness is shared and selected item must exist", () => {
  const draft = validateRecord({
    number: "1",
    object: "Objeto",
    uasg: "000001",
    items: [item],
  });
  assert.equal(readiness(draft).ready, false);
  assert.ok(readiness(draft).missingFields.includes("supplierDocument"));
  assert.throws(() => readiness(draft, "missing"), /Item/);
});

test("shared server validation returns canonical identifiers", () => {
  const record = validateRecord({
    number: "DEMO",
    object: "Objeto",
    uasg: "001234",
    organizationState: "ms",
    organizationDocument: "11.222.333/0001-81",
  });
  assert.equal(record.organizationState, "MS");
  assert.equal(record.organizationDocument, "11222333000181");
});
test("legacy invalid documents and UF prevent document readiness", () => {
  const record = {
    number: "1",
    processNumber: "PROC",
    purchaseNumber: "COMPRA",
    object: "Objeto",
    uasg: "001234",
    organizationName: "Órgão",
    organizationDocument: "123",
    organizationStreet: "Rua",
    organizationCity: "Cidade",
    organizationState: "XX",
    authorityName: "Pessoa",
    authorityRole: "Diretor",
    supplierName: "Empresa",
    supplierDocument: "11111111111",
    items: [item],
  };
  const result = readiness(record);
  assert.equal(result.ready, false);
  for (const key of [
    "supplierDocument",
    "organizationDocument",
    "organizationState",
  ])
    assert.ok(result.missingFields.includes(key));
});
