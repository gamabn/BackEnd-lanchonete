import { ProductInputError } from "../product/productValidation";

export function validateOptionPrice(value: unknown): number {
  if (typeof value !== "number" || !/^\d+(?:\.\d{1,2})?$/.test(String(value))) {
    throw new ProductInputError("Informe um preço adicional não negativo, com até duas casas decimais.");
  }
  return value;
}
