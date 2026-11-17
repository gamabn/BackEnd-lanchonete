import { OrderValidationError } from "./orderValidation";

export interface PickupAddressSnapshot {
  name: string;
  street: string;
  number: string;
  neighborhood: string;
  city: string;
}

/** Only receives the restaurant row locked by the order transaction. */
export function restaurantPickupAddress(store: Record<string, unknown>): PickupAddressSnapshot {
  const snapshot: PickupAddressSnapshot = { name: "", street: "", number: "", neighborhood: "", city: "" };
  for (const field of ["name", "street", "number", "neighborhood", "city"] as const) {
    const value = store[field];
    if (typeof value !== "string" && !(field === "number" && typeof value === "number" && Number.isFinite(value))) {
      throw new OrderValidationError("Endereço do estabelecimento indisponível para retirada.");
    }
    const clean = String(value).trim();
    if (!clean || /^(null|undefined|\[object Object\])$/i.test(clean) || /[\x00-\x1f\x7f]/.test(clean)) {
      throw new OrderValidationError("Endereço do estabelecimento indisponível para retirada.");
    }
    snapshot[field] = clean;
  }
  return snapshot;
}
