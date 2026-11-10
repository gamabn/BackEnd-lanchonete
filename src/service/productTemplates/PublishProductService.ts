import { pool } from "../../database";
import { ValidateProductPublicationService } from "./ValidateProductPublicationService";

interface PublishProductRequest {
  restaurantId: string;
  productId: string;
}

export class PublishProductService {
  async execute({ restaurantId, productId }: PublishProductRequest) {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Bloqueia o produto durante a publicação.
      const productResult = await client.query(
        `
        SELECT id, name, published
        FROM public.products
        WHERE id = $1
          AND restaurant_id = $2
        FOR UPDATE
        `,
        [productId, restaurantId],
      );

      if (productResult.rowCount === 0) {
        await client.query("ROLLBACK");

        return {
          status: 404,
          data: {
            error: "Produto não encontrado.",
          },
        };
      }

      // Valida a configuração usando a mesma transação.
      const validationService = new ValidateProductPublicationService();

      const validation = await validationService.execute({
        restaurantId,
        productId,
        client,
      });

      if (!validation.valid) {
        await client.query("ROLLBACK");

        return {
          status: 422,
          data: {
            error: "Produto não está pronto para publicação.",
            details: validation.errors,
          },
        };
      }

      // Publica o produto.
      const result = await client.query(
        `
        UPDATE public.products
        SET published = TRUE
        WHERE id = $1
          AND restaurant_id = $2
        RETURNING id, name, published
        `,
        [productId, restaurantId],
      );

      await client.query("COMMIT");

      return {
        status: 200,
        data: {
          message: "Produto publicado com sucesso.",
          product: result.rows[0],
        },
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
