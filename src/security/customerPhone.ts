/** Preserve every digit. National/international conversion requires country metadata. */
export function normalizeCustomerPhone(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 64) return undefined;
  const formatted = value.trim();
  if (!/^\+?\(?[0-9][0-9 ()\-.]*$/.test(formatted)) return undefined;
  const digits = formatted.replace(/[ ()\-.]/g, "").replace(/^\+/, "");
  return /^[1-9][0-9]{6,14}$/.test(digits) ? digits : undefined;
}

/** Only Brazilian geographic fixed/mobile numbers; never repair a subscriber number. */
export function brazilianNationalPhone(value: unknown): string | undefined {
  const international = normalizeCustomerPhone(value);
  if (!international?.startsWith("55")) return undefined;
  const national = international.slice(2);
  const validAreaCode = /^(?:1[1-9]|2[12478]|3[1-578]|4[1-9]|5[1345]|6[1-9]|7[134579]|8[1-9]|9[1-9])$/;
  if (!validAreaCode.test(national.slice(0, 2))) return undefined;
  return /^\d{2}(?:9\d{8}|[2-5]\d{7})$/.test(national) ? national : undefined;
}
