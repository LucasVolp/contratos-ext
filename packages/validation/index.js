const UFS = new Set(
  "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(
    " ",
  ),
);
const normalizeDocument = (value) =>
  typeof value === "string"
    ? value.replace(/[.\/\-\s]/g, "").toUpperCase()
    : "";
function isCPF(value) {
  const s = normalizeDocument(value);
  if (!/^\d{11}$/.test(s) || /^(\d)\1+$/.test(s)) return false;
  for (let length = 9; length <= 10; length++) {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += Number(s[i]) * (length + 1 - i);
    const digit = (sum * 10) % 11;
    if (Number(s[length]) !== (digit === 10 ? 0 : digit)) return false;
  }
  return true;
}
function isCNPJ(value) {
  const s = normalizeDocument(value);
  if (!/^[A-Z0-9]{12}\d{2}$/.test(s) || /^(\d)\1+$/.test(s)) return false;
  const weights = [
    [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
    [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  ];
  return weights.every((w, j) => {
    const remainder =
      w.reduce((sum, weight, i) => sum + (s.charCodeAt(i) - 48) * weight, 0) %
      11;
    return Number(s[12 + j]) === (remainder < 2 ? 0 : 11 - remainder);
  });
}
const isUASG = (value) => typeof value === "string" && /^\d{6}$/.test(value);
const isUF = (value) =>
  typeof value === "string" && UFS.has(value.toUpperCase());
function isDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const parsed = new Date(value);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}
function parseDecimal(value) {
  if (typeof value !== "string") return null;
  let s = value.trim().replace(/^R\$\s*/, "");
  if (s.includes(",")) {
    if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,6}$/.test(s)) return null;
    s = s.replace(/\./g, "").replace(",", ".");
  }
  return /^\d{1,18}(?:\.\d{1,6})?$/.test(s) ? s : null;
}
function formatDecimal(value, currency = false) {
  const parsed = parseDecimal(value);
  if (parsed === null) return String(value ?? "");
  const [integer, fraction = ""] = parsed.split(".");
  return `${currency ? "R$ " : ""}${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${fraction.padEnd(currency ? 2 : 1, "0")}`;
}
function maskDocument(value, cnpjOnly = false) {
  const s = normalizeDocument(String(value ?? ""));
  // Invalid legacy values stay visible so users can correct them.
  if (/[^A-Z0-9]/.test(s)) return String(value);
  const cnpj = cnpjOnly || /[A-Z]/.test(s) || s.length > 11;
  const groups = cnpj ? [2, 3, 3, 4, 2] : [3, 3, 3, 2];
  const separators = cnpj ? [".", ".", "/", "-"] : [".", ".", "-"];
  let position = 0;
  return (
    groups
      .map((size, i) => {
        const part = s.slice(position, position + size);
        position += size;
        return part ? (i ? separators[i - 1] : "") + part : "";
      })
      .join("") + s.slice(position)
  );
}
function compareDecimal(a, b) {
  const scaled = (s) => {
    const [i, f = ""] = s.split(".");
    return BigInt(i + f.padEnd(6, "0"));
  };
  return scaled(a) > scaled(b);
}
function validateFields(body, kind = "record") {
  const errors = {};
  const supplied = (key) =>
    body[key] !== undefined && body[key] !== null && body[key] !== "";
  const required =
    kind === "contract"
      ? [
          "number",
          "object",
          "uasg",
          "supplierName",
          "supplierDocument",
          "initialValue",
          "globalValue",
        ]
      : kind === "import"
        ? ["uasg", "from", "to"]
        : ["number", "object", "uasg"];
  for (const key of required)
    if (!String(body[key] ?? "").trim())
      errors[key] = "Preencha este campo obrigatório.";
  const textFields = [
    "number",
    "object",
    "uasg",
    "unitName",
    "supplierName",
    "supplierDocument",
    "processNumber",
    "purchaseNumber",
    "organizationName",
    "organizationDocument",
    "organizationStreet",
    "organizationNumber",
    "organizationCity",
    "organizationState",
    "authorityName",
    "authorityRole",
    "authorityRegistration",
    "ordinanceNumber",
    "supplierRepresentative",
  ];
  for (const key of textFields) {
    if (
      body[key] !== undefined &&
      body[key] !== null &&
      typeof body[key] !== "string"
    )
      errors[key] = "Informe um texto válido.";
    else if (typeof body[key] === "string" && body[key].length > 20000)
      errors[key] = "Use até 20.000 caracteres.";
  }
  if (supplied("uasg") && !isUASG(body.uasg))
    errors.uasg =
      "Informe a UASG com exatamente 6 dígitos, incluindo zeros iniciais.";
  if (
    supplied("supplierDocument") &&
    !isCPF(body.supplierDocument) &&
    !isCNPJ(body.supplierDocument)
  )
    errors.supplierDocument =
      "Informe CPF ou CNPJ válido, com os dígitos verificadores corretos.";
  if (supplied("organizationDocument") && !isCNPJ(body.organizationDocument))
    errors.organizationDocument =
      "Informe CNPJ válido, numérico ou alfanumérico, com 14 posições.";
  if (supplied("organizationState") && !isUF(body.organizationState))
    errors.organizationState = "Informe uma UF válida, como MS ou DF.";
  const dates = [
    "startDate",
    "endDate",
    "ordinanceDate",
    "ordinancePublicationDate",
    "from",
    "to",
  ];
  for (const key of dates)
    if (supplied(key) && !isDate(body[key]))
      errors[key] =
        "Data inválida. Informe uma data real no formato AAAA-MM-DD.";
  for (const [a, b] of [
    ["startDate", "endDate"],
    ["from", "to"],
  ])
    if (isDate(body[a]) && isDate(body[b]) && body[a] > body[b])
      errors[b] =
        "O fim da vigência ou consulta deve ser igual ou posterior ao início.";
  const decimalError =
    "Informe decimal não negativo, com até 18 inteiros e 6 casas decimais.";
  for (const key of ["initialValue", "globalValue"])
    if (supplied(key) && parseDecimal(body[key]) === null)
      errors[key] = decimalError;
  if (
    supplied("purchaseYear") &&
    (!Number.isInteger(Number(body.purchaseYear)) ||
      Number(body.purchaseYear) < 1900 ||
      Number(body.purchaseYear) > 2200)
  )
    errors.purchaseYear = "Informe um ano inteiro entre 1900 e 2200.";
  if (supplied("modality") && !["PREGAO", "DISPENSA"].includes(body.modality))
    errors.modality = "Selecione pregão ou dispensa.";
  if (body.renewable !== undefined && typeof body.renewable !== "boolean")
    errors.renewable = "Informe se a ata pode ser prorrogada.";
  if (body.items !== undefined && !Array.isArray(body.items))
    errors.items = "Itens devem ser uma lista.";
  const seen = new Set();
  if (Array.isArray(body.items))
    body.items.forEach((item, index) => {
      const prefix = `items.${index}.`;
      if (!item || !Number.isInteger(item.number) || item.number < 1)
        errors[prefix + "number"] =
          "Informe um número inteiro positivo para o item.";
      else if (seen.has(item.number))
        errors[prefix + "number"] = "Número de item deve ser único na ata.";
      if (!item) return;
      seen.add(item.number);
      for (const key of ["description", "brand", "model", "unit", "warranty"])
        if (
          item[key] !== undefined &&
          item[key] !== null &&
          (typeof item[key] !== "string" || item[key].length > 20000)
        )
          errors[prefix + key] =
            "Informe um texto válido com até 20.000 caracteres.";
      for (const key of ["quantity", "minimumQuantity", "unitPrice"])
        if (parseDecimal(item[key] ?? "0") === null)
          errors[prefix + key] = decimalError;
      const min = parseDecimal(item.minimumQuantity ?? "0"),
        qty = parseDecimal(item.quantity ?? "0");
      if (min !== null && qty !== null && compareDecimal(min, qty))
        errors[prefix + "minimumQuantity"] =
          "Quantidade mínima não pode superar a quantidade.";
    });
  return errors;
}
function validateFilters(body) {
  const errors = validateFields(
    { uasg: body.uasg, from: body.from, to: body.to },
    "import",
  );
  for (const key of ["uasg", "from", "to"])
    if (body[key] === undefined || body[key] === null || body[key] === "")
      delete errors[key];
  return errors;
}
// Refresh only the field being left and rules that depend on it.
function blurFieldErrors(previous, current, name) {
  const keys = new Set([name]);
  if (name === "startDate" || name === "endDate") {
    keys.add("startDate");
    keys.add("endDate");
  }
  const quantity = /^(items\.\d+\.)(quantity|minimumQuantity)$/.exec(name);
  if (quantity) {
    keys.add(quantity[1] + "quantity");
    keys.add(quantity[1] + "minimumQuantity");
  }
  if (/^items\.\d+\.number$/.test(name)) {
    for (const key of [...Object.keys(previous), ...Object.keys(current)])
      if (/^items\.\d+\.number$/.test(key)) keys.add(key);
  }
  const next = { ...previous };
  for (const key of keys) {
    if (current[key]) next[key] = current[key];
    else delete next[key];
  }
  return next;
}
module.exports = {
  normalizeDocument,
  isCPF,
  isCNPJ,
  isUASG,
  isUF,
  isDate,
  parseDecimal,
  formatDecimal,
  maskDocument,
  validateFields,
  validateFilters,
  blurFieldErrors,
};
