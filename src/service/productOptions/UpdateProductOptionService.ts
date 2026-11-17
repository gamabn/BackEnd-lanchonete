import { productTransaction } from "../product/productTransaction";
import { ProductInputError, requiredText } from "../product/productValidation";
import { ensurePublishedProductValid } from "../productTemplates/ensurePublishedProductValid";
import { validateOptionPrice } from "./productOptionPrice";

interface UpdateProductOptionRequest {
  restaurantId: string;
  optionId: string;
  name?: string;
  additionalPrice?: number;
  available?: boolean;
}

export class UpdateProductOptionService {
  async execute({ restaurantId, optionId, name, additionalPrice, available }: UpdateProductOptionRequest) {
    if (name === undefined && additionalPrice === undefined && available === undefined) {
      throw new ProductInputError("Informe pelo menos um campo para atualizar.");
    }
    if (available !== undefined && typeof available !== "boolean") {
      throw new ProductInputError("Disponibilidade inválida.");
    }

    const normalizedName = name === undefined ? undefined : requiredText(name, "Nome do ingrediente");
    const price = additionalPrice === undefined ? undefined : validateOptionPrice(additionalPrice);

    return productTransaction(async (client) => {
      const { rows: [owner] } = await client.query<{ id: string; published: boolean }>(
        `SELECT p.id, p.published
         FROM public.product_options o
         JOIN public.product_option_groups g ON g.id = o.group_id
         JOIN public.products p ON p.id = g.product_id
         WHERE o.id = $1 AND p.restaurant_id = $2
         FOR UPDATE OF p`,
        [optionId, restaurantId],
      );
      if (!owner) return null;

      const { rows: [option] } = await client.query(
        `UPDATE public.product_options o
         SET name = COALESCE($3, o.name),
             additional_price = COALESCE($4, o.additional_price),
             available = COALESCE($5, o.available)
         FROM public.product_option_groups g
         WHERE o.id = $1 AND o.group_id = g.id AND g.product_id = $2
         RETURNING o.id, o.group_id, o.name, o.additional_price, o.available`,
        [optionId, owner.id, normalizedName, price, available],
      );

      if (option) {
        await ensurePublishedProductValid(client, restaurantId, owner.id, owner.published);
      }
      return option ?? null;
    });
  }
}
