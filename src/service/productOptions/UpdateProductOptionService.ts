import { pool } from "../../database";

interface UpdateProductOptionRequest {
  restaurantId: string;
  optionId: string;
  name?: string;
  additionalPrice?: number;
  available?: boolean;
}

export class UpdateProductOptionService {
  async execute({
    restaurantId,
    optionId,
    name,
    additionalPrice,
    available,
  }: UpdateProductOptionRequest) {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        throw new Error("Nome do ingrediente inválido.");
      }

      values.push(name.trim());
      fields.push(`name = $${values.length}`);
    }

    if (additionalPrice !== undefined) {
      if (
        typeof additionalPrice !== "number" ||
        !Number.isFinite(additionalPrice) ||
        additionalPrice < 0 ||
        !Number.isInteger(additionalPrice * 100)
      ) {
        throw new Error("Preço adicional inválido.");
      }

      values.push(additionalPrice);
      fields.push(`additional_price = $${values.length}`);
    }

    if (available !== undefined) {
      if (typeof available !== "boolean") {
        throw new Error("Disponibilidade inválida.");
      }

      values.push(available);
      fields.push(`available = $${values.length}`);
    }

    if (fields.length === 0) {
      throw new Error("Informe pelo menos um campo para atualizar.");
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // 1. Localizar o produto e verificar o restaurante
      const ownerResult = await client.query<{
        product_id: string;
      }>(
        `
        SELECT pog.product_id
        FROM public.product_options po
        INNER JOIN public.product_option_groups pog
          ON pog.id = po.group_id
        INNER JOIN public.products p
          ON p.id = pog.product_id
        WHERE po.id = $1
          AND p.restaurant_id = $2
        `,
        [optionId, restaurantId],
      );

      const owner = ownerResult.rows[0];

      if (!owner) {
        await client.query("ROLLBACK");
        return null;
      }

      // 2. Bloquear o produto durante a alteração
      const lockedProduct = await client.query(
        `
        SELECT id
        FROM public.products
        WHERE id = $1
          AND restaurant_id = $2
        FOR UPDATE
        `,
        [owner.product_id, restaurantId],
      );

      if (lockedProduct.rowCount !== 1) {
        throw new Error("Produto não encontrado para atualização.");
      }

      // 3. Atualizar o ingrediente
      values.push(optionId);
      const optionParam = values.length;

      values.push(owner.product_id);
      const productParam = values.length;

      const result = await client.query(
        `
        UPDATE public.product_options po
        SET ${fields.join(", ")}
        FROM public.product_option_groups pog
        WHERE po.id = $${optionParam}
          AND po.group_id = pog.id
          AND pog.product_id = $${productParam}
        RETURNING
          po.id,
          po.group_id,
          po.name,
          po.additional_price,
          po.available
        `,
        values,
      );

      await client.query("COMMIT");

      return result.rows[0] ?? null;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
