import { formatDecimal, parseDecimal } from "@contracts/validation";

/** Signed source amounts retain exact precision; shared validation owns decimal formatting. */
export function formatMoney(value: unknown) {
  if (value === null || value === undefined || value === "")
    return "Não informado";
  const raw = String(value);
  const negative = raw.startsWith("-");
  let formatted = formatDecimal(negative ? raw.slice(1) : raw, true);
  // Remove only insignificant source padding; preserve every nonzero decimal place.
  const comma = formatted.lastIndexOf(",");
  if (formatted.startsWith("R$ ") && comma >= 0)
    formatted =
      formatted.slice(0, comma + 1) +
      formatted
        .slice(comma + 1)
        .replace(/0+$/, "")
        .padEnd(2, "0");
  return `${negative ? "-" : ""}${formatted}`;
}

export function formatSourceDecimal(value: unknown) {
  if (value === null || value === undefined || value === "")
    return "Não informado";
  const raw = String(value);
  return raw.startsWith("-")
    ? `-${formatDecimal(raw.slice(1))}`
    : formatDecimal(raw);
}

/** Integer millionths are only a chart coordinate representation, never a new financial total. */
export function chartUnits(value: string | null): bigint | null {
  if (value === null) return null;
  const negative = value.startsWith("-");
  const absolute = negative ? value.slice(1) : value;
  // Aggregate totals may exceed the input precision of parseDecimal; they are already validated by the API.
  const [integer, fraction = ""] = (parseDecimal(absolute) ?? absolute).split(
    ".",
  );
  if (fraction.length > 6) return null;
  try {
    return (
      BigInt(integer + fraction.padEnd(6, "0")) * BigInt(negative ? -1 : 1)
    );
  } catch {
    return null;
  }
}

/** Only dimensionless, bounded screen coordinates become JavaScript numbers. */
export function chartRatio(value: bigint, maximum: bigint) {
  return maximum === BigInt(0)
    ? 0
    : Number((value * BigInt(10000)) / maximum) / 10000;
}

export function compactMoney(value: unknown) {
  if (value === null || value === undefined || value === "")
    return "Não informado";
  const raw = String(value),
    negative = raw.startsWith("-");
  const absolute = negative ? raw.slice(1) : raw;
  const [integer, fraction = ""] = (parseDecimal(absolute) ?? absolute).split(
    ".",
  );
  try {
    // Products and SQL totals may retain more decimal places than individual inputs.
    const digits = BigInt(integer + fraction),
      scale = BigInt(10) ** BigInt(fraction.length);
    if (digits > BigInt(0) && digits * BigInt(100) < scale)
      return formatMoney(value);
    const [factor, suffix] =
      digits >= scale * BigInt(1000000000)
        ? [BigInt(1000000000), "bi"]
        : digits >= scale * BigInt(1000000)
          ? [BigInt(1000000), "mi"]
          : digits >= scale * BigInt(1000)
            ? [BigInt(1000), "mil"]
            : [BigInt(1), ""];
    const divisor = scale * factor;
    const hundredths = (digits * BigInt(100) + divisor / BigInt(2)) / divisor;
    const decimal = `${hundredths / BigInt(100)}.${String(hundredths % BigInt(100)).padStart(2, "0")}`;
    return `${negative ? "-" : ""}${formatDecimal(decimal, true)}${suffix ? ` ${suffix}` : ""}`;
  } catch {
    return "Não informado";
  }
}
