import { pool } from "../../database";

interface CreateProductOptionRequest {
  restaurantId: string;
  groupId: string;
  name: string;
  additionalPrice?: number;
}

export class CreateProductOptionService {
  async execute({
    restaurantId,
    groupId,
    name,
    additionalPrice = 0,
  }: CreateProductOptionRequest) {
    const normalizedName = name?.trim();

    if (!normalizedName) {
      throw new Error("O nome do ingrediente é obrigatório.");
    }

    if (
      typeof additionalPrice !== "number" ||
      !Number.isFinite(additionalPrice) ||
      additionalPrice < 0
    ) {
      throw new Error("Preço adicional inválido.");
    }

    const result = await pool.query(
      `INSERT INTO public.product_options
        (group_id, name, additional_price)
       SELECT
         pog.id, $3, $4
       FROM public.product_option_groups pog
       INNER JOIN public.products p
         ON p.id = pog.product_id
       WHERE pog.id = $1
         AND p.restaurant_id = $2
       RETURNING
         id,
         group_id,
         name,
         additional_price,
         available`,
      [groupId, restaurantId, normalizedName, additionalPrice],
    );

    if (result.rowCount === 0) {
      throw new Error("Grupo não encontrado ou não pertence ao restaurante.");
    }

    return result.rows[0];
  }
}
