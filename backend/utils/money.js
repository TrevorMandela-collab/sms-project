const MAX_AMOUNT = 9999999999.99;

function toCents(value) {
  if (
    value === null ||
    value === undefined ||
    typeof value === "boolean" ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return null;
  }
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > MAX_AMOUNT) {
    return null;
  }

  const cents = Math.round(amount * 100);
  const precisionTolerance = Number.EPSILON * Math.max(1, Math.abs(amount));
  if (Math.abs(amount - cents / 100) > precisionTolerance) {
    return null;
  }
  return cents;
}

module.exports = { toCents };
