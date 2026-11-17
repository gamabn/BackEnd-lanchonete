import type { PoolClient } from "pg";
import { ProductInputError } from "../product/productValidation";
import { ValidateProductPublicationService } from "./ValidateProductPublicationService";

export async function ensurePublishedProductValid(
  client: PoolClient,
  restaurantId: string,
  productId: string,
  published: boolean,
) {
  if (!published) return;

  // Simple products use the legacy checkout contract.
  const variants = await client.query("SELECT 1 FROM public.product_variants WHERE product_id = $1 LIMIT 1", [productId]);
  if (!variants.rowCount) return;

  const validation = await new ValidateProductPublicationService().execute({ client, restaurantId, productId });
  if (!validation.valid) {
    throw new ProductInputError("A alteração deixaria o produto publicado inválido.", 422, validation.errors);
  }
}
