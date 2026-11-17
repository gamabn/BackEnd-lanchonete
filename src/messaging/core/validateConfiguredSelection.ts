import { pool } from "../../database";

import { ValidateAndPriceConfiguredProductService } from "../../service/productTemplates/ValidateAndPriceConfiguredProductService";

interface ValidateBotSelectionRequest {
  restaurantId: string;
  productId: string;
  variantId: string;
  optionIds: string[];
}

export async function validateBotSelection({
  restaurantId,
  productId,
  variantId,
  optionIds,
}: ValidateBotSelectionRequest) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const service = new ValidateAndPriceConfiguredProductService();

    const result = await service.execute({
      client,
      restaurantId,
      productId,
      variantId,
      optionIds,
    });

    await client.query("COMMIT");

    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
