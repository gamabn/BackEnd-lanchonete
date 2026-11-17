import { moneyCents, moneyText } from "../service/order/orderValidation";

/** Decimal validation shared by the quote and transactional address persistence. */
export function deliveryFee(value: unknown): string | undefined {
  const text = typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
  if (text === undefined || !/^[0-9]{1,8}(?:\.[0-9]{1,2})?$/.test(text)) return undefined;
  return moneyText(moneyCents(text));
}
