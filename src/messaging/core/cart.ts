import type { OrderItemInput } from "../../service/order/orderValidation";

export interface BotCartItem {
  productId: string;
  productName: string;
  quantity: number;

  variantId?: string;
  variantName?: string;
  optionIds?: string[];

  // Valor exibido durante a conversa.
  // O backend recalculará no checkout.
  unitPrice: string;
}

export class BotCart {
  private items: BotCartItem[] = [];

  add(item: BotCartItem): void {
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
      throw new Error("Quantidade inválida.");
    }

    const isSimple = !item.variantId;

    if (isSimple) {
      const existing = this.items.find(
        (current) => current.productId === item.productId && !current.variantId,
      );

      if (existing) {
        const quantity = existing.quantity + item.quantity;

        if (quantity > 32767) {
          throw new Error("Quantidade máxima excedida.");
        }

        existing.quantity = quantity;
        return;
      }
    }

    this.items.push({
      ...item,
      optionIds: item.optionIds ? [...item.optionIds] : undefined,
    });
  }

  remove(index: number): boolean {
    if (!Number.isInteger(index) || index < 0 || index >= this.items.length) {
      return false;
    }

    this.items.splice(index, 1);
    return true;
  }

  list(): BotCartItem[] {
    return this.items.map((item) => ({
      ...item,
      optionIds: item.optionIds ? [...item.optionIds] : undefined,
    }));
  }

  clear(): void {
    this.items = [];
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  toOrderItems(): OrderItemInput[] {
    return this.items.map((item) => ({
      product_id: item.productId,
      quantity: item.quantity,
      ...(item.variantId
        ? {
            variant_id: item.variantId,
            option_ids: item.optionIds ?? [],
          }
        : {}),
    }));
  }
}
