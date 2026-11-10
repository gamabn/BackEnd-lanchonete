import { pool } from "../../database";
import type { PoolClient } from "pg";

interface UpdateStoreTypesData {
  restaurantId: string;
  primaryTypeId: string;
  additionalTypeIds: string[];
}

interface StoreType {
  id: string;
  name: string;
  slug: string;
  is_primary: boolean;
}

export class StoreTypesValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreTypesValidationError";
  }
}

export class UpdateStoreTypesService {
  async execute({
    restaurantId,
    primaryTypeId,
    additionalTypeIds,
  }: UpdateStoreTypesData): Promise<StoreType[]> {
    const allIds = [primaryTypeId, ...additionalTypeIds];

    if (
      !primaryTypeId ||
      !Array.isArray(additionalTypeIds) ||
      allIds.some(
        (id) =>
          typeof id !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            id,
          ),
      )
    ) {
      throw new StoreTypesValidationError(
        "Informe categorias com IDs válidos.",
      );
    }

    if (new Set(allIds).size !== allIds.length) {
      throw new StoreTypesValidationError(
        "Não é permitido repetir categorias.",
      );
    }

    const client: PoolClient = await pool.connect();

    try {
      await client.query("BEGIN");

      // Bloqueia a loja durante a atualização das categorias.
      const restaurant = await client.query(
        `SELECT id FROM public.restaurants
         WHERE id = $1 FOR UPDATE`,
        [restaurantId],
      );

      if (restaurant.rowCount !== 1) {
        throw new StoreTypesValidationError("Estabelecimento não encontrado.");
      }

      // Verifica se todas as categorias existem e estão ativas.
      const validTypes = await client.query<{ id: string }>(
        `SELECT id FROM public.restaurant_types
         WHERE id = ANY($1::uuid[]) AND active = TRUE`,
        [allIds],
      );

      if (validTypes.rows.length !== allIds.length) {
        throw new StoreTypesValidationError(
          "Uma ou mais categorias são inexistentes ou inativas.",
        );
      }

      // Substitui os vínculos anteriores.
      await client.query(
        `DELETE FROM public.restaurant_type_links
         WHERE restaurant_id = $1`,
        [restaurantId],
      );

      // Insere a categoria principal e as adicionais.
      for (const typeId of allIds) {
        await client.query(
          `INSERT INTO public.restaurant_type_links
           (restaurant_id, type_id, is_primary)
           VALUES ($1, $2, $3)`,
          [restaurantId, typeId, typeId === primaryTypeId],
        );
      }

      const result = await client.query<StoreType>(
        `SELECT
           rt.id,
           rt.name,
           rt.slug,
           rtl.is_primary
         FROM public.restaurant_type_links rtl
         INNER JOIN public.restaurant_types rt
           ON rt.id = rtl.type_id
         WHERE rtl.restaurant_id = $1
         ORDER BY rtl.is_primary DESC, rt.name ASC`,
        [restaurantId],
      );

      await client.query("COMMIT");

      return result.rows;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
