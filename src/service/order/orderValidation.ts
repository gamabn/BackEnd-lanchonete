export class OrderValidationError extends Error {
  constructor(
    message: string,
    public readonly status = 422,
  ) {
    super(message);
  }
}

export interface OrderItemInput {
  product_id: string;
  quantity: number;
  variant_id?: string;
  option_ids?: string[];
}

interface OrderInputBase {
  items: OrderItemInput[];
  payment_method: "Dinheiro" | "Cartao" | "Pix";
  change_for: string;
}

export type OrderInput = OrderInputBase & (
  | { fulfillment_type: "DELIVERY"; bairro_id: string }
  | { fulfillment_type: "PICKUP"; bairro_id: null }
);

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function moneyCents(value: unknown): bigint {
  const text =
    typeof value === "number" && Number.isFinite(value) ? String(value) : value;

  if (typeof text !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(text)) {
    throw new OrderValidationError("Valor monetário inválido.");
  }

  const [whole, fraction = ""] = text.split(".");

  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

export function moneyText(cents: bigint): string {
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

export function parseOrder(input: unknown): OrderInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new OrderValidationError("Pedido inválido.");
  }

  const body = input as Record<string, unknown>;

  const allowed = ["items", "bairro_id", "payment_method", "change_for", "fulfillment_type"];

  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new OrderValidationError(
      "Envie somente itens, modalidade, bairro, pagamento e troco.",
    );
  }

  const fulfillment = body.fulfillment_type === undefined ? "DELIVERY" : body.fulfillment_type;
  if (fulfillment !== "DELIVERY" && fulfillment !== "PICKUP") {
    throw new OrderValidationError("Modalidade de atendimento inválida.");
  }
  if (fulfillment === "DELIVERY" && (typeof body.bairro_id !== "string" || !uuidRegex.test(body.bairro_id))) {
    throw new OrderValidationError("Bairro inválido.");
  }
  if (fulfillment === "PICKUP" && body.bairro_id !== undefined && body.bairro_id !== null) {
    throw new OrderValidationError("Retirada não permite bairro de entrega.");
  }

  if (
    body.payment_method !== "Dinheiro" &&
    body.payment_method !== "Cartao" &&
    body.payment_method !== "Pix"
  ) {
    throw new OrderValidationError("Forma de pagamento inválida.");
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new OrderValidationError("Pedido deve conter itens.");
  }

  const seenTraditional = new Set<string>();

  const items = body.items.map((raw: unknown): OrderItemInput => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new OrderValidationError("Item inválido.");
    }

    const item = raw as Record<string, unknown>;

    const allowedItemFields = [
      "product_id",
      "quantity",
      "variant_id",
      "option_ids",
    ];

    if (Object.keys(item).some((key) => !allowedItemFields.includes(key))) {
      throw new OrderValidationError("O item contém campos não permitidos.");
    }

    if (
      typeof item.product_id !== "string" ||
      !uuidRegex.test(item.product_id)
    ) {
      throw new OrderValidationError("ID do produto inválido.");
    }

    if (
      typeof item.quantity !== "number" ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity <= 0 ||
      item.quantity > 32767
    ) {
      throw new OrderValidationError("Quantidade inválida.");
    }

    const hasVariant = item.variant_id !== undefined;
    const hasOptions = item.option_ids !== undefined;

    // Produto tradicional
    if (!hasVariant && !hasOptions) {
      if (seenTraditional.has(item.product_id)) {
        throw new OrderValidationError("Produto tradicional duplicado.");
      }

      seenTraditional.add(item.product_id);

      return {
        product_id: item.product_id,
        quantity: item.quantity,
      };
    }

    // Produto configurável
    if (
      !hasVariant ||
      typeof item.variant_id !== "string" ||
      !uuidRegex.test(item.variant_id)
    ) {
      throw new OrderValidationError("Tamanho do produto inválido.");
    }

    if (
      !Array.isArray(item.option_ids) ||
      item.option_ids.length > 100 ||
      !item.option_ids.every(
        (id) => typeof id === "string" && uuidRegex.test(id),
      )
    ) {
      throw new OrderValidationError("Lista de ingredientes inválida.");
    }

    const optionIds = item.option_ids as string[];

    if (new Set(optionIds).size !== optionIds.length) {
      throw new OrderValidationError("Ingredientes duplicados no mesmo item.");
    }

    return {
      product_id: item.product_id,
      quantity: item.quantity,
      variant_id: item.variant_id,
      option_ids: optionIds,
    };
  });

  const change = moneyCents(body.change_for ?? "0");

  if (body.payment_method !== "Dinheiro" && change !== 0n) {
    throw new OrderValidationError("Troco somente para pagamento em dinheiro.");
  }

  return {
    items,
    ...(fulfillment === "DELIVERY"
      ? { fulfillment_type: "DELIVERY" as const, bairro_id: body.bairro_id as string }
      : { fulfillment_type: "PICKUP" as const, bairro_id: null }),
    payment_method: body.payment_method,
    change_for: moneyText(change),
  };
}
