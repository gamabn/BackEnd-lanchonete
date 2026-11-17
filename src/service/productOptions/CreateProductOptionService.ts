import { productTransaction } from "../product/productTransaction";
import { ProductInputError, requiredText } from "../product/productValidation";
import { validateOptionPrice } from "./productOptionPrice";

interface CreateProductOptionRequest {
  restaurantId: string;
  groupId: string;
  name: string;
  additionalPrice?: number;
}

export class CreateProductOptionService {
  async execute({ restaurantId, groupId, name, additionalPrice = 0 }: CreateProductOptionRequest) {
    const normalizedName = requiredText(name, "Nome do ingrediente");
    const price = validateOptionPrice(additionalPrice);

    return productTransaction(async (client) => {
      const owner = await client.query(
        `SELECT p.id
         FROM public.product_option_groups g
         JOIN public.products p ON p.id = g.product_id
         WHERE g.id = $1 AND p.restaurant_id = $2
         FOR UPDATE OF p`,
        [groupId, restaurantId],
      );
      if (!owner.rowCount) {
        throw new ProductInputError("Grupo não encontrado.", 404);
      }

      const result = await client.query(
        `INSERT INTO public.product_options (group_id, name, additional_price)
         VALUES ($1, $2, $3)
         RETURNING id, group_id, name, additional_price, available`,
        [groupId, normalizedName, price],
      );
      return result.rows[0];
    });
  }
}
