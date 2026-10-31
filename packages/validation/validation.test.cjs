const { test } = require("node:test");
const assert = require("node:assert/strict");
const v = require("./index.js");
test("CPF checks all digits and rejects repeated digits", () => {
  assert.equal(v.isCPF("529.982.247-25"), true);
  for (const value of ["52998224724", "11111111111", "123"])
    assert.equal(v.isCPF(value), false);
});
test("CNPJ numeric and Receita alphanumeric examples retain letters", () => {
  for (const value of [
    "11.222.333/0001-81",
    "12.ABC.345/01DE-35",
    "00.000.000/E08G-12",
  ])
    assert.equal(v.isCNPJ(value), true);
  for (const value of [
    "11222333000180",
    "00000000000000",
    "12.ABC.345/01DE-34",
  ])
    assert.equal(v.isCNPJ(value), false);
  assert.equal(v.normalizeDocument("12.abc.345/01de-35"), "12ABC34501DE35");
  assert.equal(v.maskDocument("12ABC34501DE35", true), "12.ABC.345/01DE-35");
});
test("UASG preserves zeros and UF uses official abbreviations", () => {
  assert.equal(v.isUASG("001234"), true);
  assert.equal(v.isUASG("1234"), false);
  assert.equal(v.isUF("ms"), true);
  assert.equal(v.isUF("XX"), false);
});
test("decimal parsing is exact and rejects negative, malformed and excess precision", () => {
  assert.equal(v.parseDecimal("R$ 1.234,567890"), "1234.567890");
  assert.equal(
    v.parseDecimal("999999999999999999.123456"),
    "999999999999999999.123456",
  );
  for (const value of [
    "-1",
    "1.2345678",
    "1,2345678",
    "1.2.3",
    "1000000000000000000",
    "",
    1,
  ])
    assert.equal(v.parseDecimal(value), null);
  assert.equal(v.formatDecimal("1234.567890", true), "R$ 1.234,567890");
});
test("real calendar dates, ranges and supplied invalid draft fields are checked", () => {
  assert.equal(v.isDate("2024-02-29"), true);
  assert.equal(v.isDate("2026-02-29"), false);
  const draft = { number: "DEMO", object: "Objeto", uasg: "001234" };
  assert.deepEqual(v.validateFields(draft, "record"), {});
  const errors = v.validateFields(
    {
      ...draft,
      supplierDocument: "123",
      organizationState: "XX",
      startDate: "2026-12-01",
      endDate: "2026-01-01",
    },
    "record",
  );
  assert.ok(errors.supplierDocument);
  assert.ok(errors.organizationState);
  assert.ok(errors.endDate);
  assert.ok(
    v.validateFields(
      {
        ...draft,
        items: [
          { number: 1, quantity: "1", minimumQuantity: "2", unitPrice: "0" },
        ],
      },
      "record",
    )["items.0.minimumQuantity"],
  );
});
test("unknown extra JSON fields are ignored and known text fields reject non-strings", () => {
  const draft = { number: "DEMO", object: "Objeto", uasg: "001234" };
  assert.deepEqual(
    v.validateFields({ ...draft, extra: "x".repeat(20001) }, "record"),
    {},
  );
  assert.ok(
    v.validateFields({ ...draft, supplierName: 123 }, "record").supplierName,
  );
});
test("optional list filters validate only supplied fields and date ordering", () => {
  assert.deepEqual(v.validateFilters({}), {});
  assert.ok(v.validateFilters({ uasg: "123" }).uasg);
  assert.ok(v.validateFilters({ from: "2026-12-01", to: "2026-01-01" }).to);
});

test("blur refreshes related date and item errors without revealing unrelated required fields", () => {
  const errors = {
    number: "Obrigatório",
    endDate: "Intervalo inválido",
    "items.0.minimumQuantity": "Mínima maior",
    "items.1.number": "Duplicado",
  };
  assert.deepEqual(v.blurFieldErrors({}, errors, "startDate"), {
    endDate: "Intervalo inválido",
  });
  assert.deepEqual(v.blurFieldErrors({}, errors, "items.0.quantity"), {
    "items.0.minimumQuantity": "Mínima maior",
  });
  assert.deepEqual(v.blurFieldErrors({}, errors, "items.0.number"), {
    "items.1.number": "Duplicado",
  });
  assert.deepEqual(
    v.blurFieldErrors(
      { endDate: "Erro antigo", number: "Obrigatório" },
      {},
      "startDate",
    ),
    { number: "Obrigatório" },
  );
  assert.deepEqual(
    v.blurFieldErrors(
      { "items.0.minimumQuantity": "Erro antigo" },
      {},
      "items.0.quantity",
    ),
    {},
  );
});
