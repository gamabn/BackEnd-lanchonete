export type PaymentMethod = "PIX" | "DINHEIRO" | "DEBITO" | "CREDITO";

export const PAYMENT_MENU = [
  "💳 ESCOLHA A FORMA DE PAGAMENTO",
  "",
  "1 - PIX",
  "2 - Dinheiro",
  "3 - Cartão de débito",
  "4 - Cartão de crédito",
  "",
  "0 - Voltar",
].join("\n");

export function parsePaymentMethod(input: string): PaymentMethod | null {
  const options: Record<string, PaymentMethod> = {
    "1": "PIX",
    "2": "DINHEIRO",
    "3": "DEBITO",
    "4": "CREDITO",
  };

  return options[input.trim()] ?? null;
}

export function paymentMethodLabel(method: PaymentMethod): string {
  const labels: Record<PaymentMethod, string> = {
    PIX: "PIX",
    DINHEIRO: "Dinheiro",
    DEBITO: "Cartão de débito",
    CREDITO: "Cartão de crédito",
  };

  return labels[method];
}

/** Strict decimal input; never round user-provided money. */
export function parseCashAmount(input: string): bigint | undefined {
  const text = input.trim();
  if (!/^\d{1,8}(?:[.,]\d{1,2})?$/.test(text)) return;
  const [whole, fraction = ""] = text.replace(",", ".").split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return cents > 0n ? cents : undefined;
}

export function formatPaymentMoney(cents: bigint): string {
  return `R$ ${(cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${(cents % 100n).toString().padStart(2, "0")}`;
}

export const CASH_CHANGE_MENU = "Precisa de troco?\n\n1 - Sim\n2 - Não\n0 - Voltar ao pagamento";
