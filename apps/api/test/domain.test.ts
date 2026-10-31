import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contractStatus,
  overlaps,
  validateContract,
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
const contract = {
  number: "1",
  object: "Compra",
  supplierName: "Fornecedor",
  supplierDocument: "123",
  uasg: "123456",
  initialValue: "0.10",
  globalValue: "0.20",
};
test("contract validates real calendar days, ordering and decimal inputs", () => {
  assert.throws(
    () => validateContract({ ...contract, startDate: "2026-02-30" }),
    /data|Data/,
  );
  assert.throws(
    () =>
      validateContract({
        ...contract,
        startDate: "2026-02-02",
        endDate: "2026-01-01",
      }),
    /vigência/,
  );
  assert.throws(
    () => validateContract({ ...contract, globalValue: "-1" }),
    /decimal/,
  );
  assert.throws(
    () => validateContract({ ...contract, globalValue: 0.1 }),
    /decimal/,
  );
  assert.equal(validateContract(contract).globalValue, "0.20");
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
    validateRecord({ number: "1", object: "Objeto", uasg: "1" }).items.length,
    0,
  );
  assert.throws(
    () =>
      validateRecord({
        number: "1",
        object: "Objeto",
        uasg: "1",
        items: [item, item],
      }),
    /único/,
  );
  assert.throws(
    () =>
      validateRecord({
        number: "1",
        object: "Objeto",
        uasg: "1",
        items: [{ ...item, minimumQuantity: "2" }],
      }),
    /mínima/,
  );
});
test("readiness is shared and selected item must exist", () => {
  const draft = validateRecord({
    number: "1",
    object: "Objeto",
    uasg: "1",
    items: [item],
  });
  assert.equal(readiness(draft).ready, false);
  assert.ok(readiness(draft).missingFields.includes("supplierDocument"));
  assert.throws(() => readiness(draft, "missing"), /Item/);
});
