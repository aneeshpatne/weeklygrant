export const moneyFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const integerFormat = new Intl.NumberFormat("en-US");

export const compactFormat = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export const dateFormat = new Intl.DateTimeFormat();

export function signedPercent(value, digits = 0) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const amount = Number(value);
  const places = Math.abs(amount) >= 9.5 ? 0 : Math.max(digits, 1);
  return `${amount > 0 ? "+" : ""}${amount.toFixed(places)}%`;
}
