import { pool } from "../../database";

interface StoreType {
  id: string;
  name: string;
  slug: string;
  is_primary: boolean;
}

export class GetStoreTypesService {
  async execute(restaurantId: string): Promise<StoreType[]> {
    const { rows } = await pool.query<StoreType>(
      `
      SELECT
        rt.id,
        rt.name,
        rt.slug,
        rtl.is_primary
      FROM public.restaurant_type_links rtl
      INNER JOIN public.restaurant_types rt
        ON rt.id = rtl.type_id
      WHERE rtl.restaurant_id = $1
      ORDER BY rtl.is_primary DESC, rt.name ASC
      `,
      [restaurantId],
    );

    return rows;
  }
}
