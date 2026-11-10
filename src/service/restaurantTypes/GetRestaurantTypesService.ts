import { pool } from "../../database";

export interface RestaurantType {
  id: string;
  name: string;
  slug: string;
  active: boolean;
}

export class GetRestaurantTypesService {
  async execute(): Promise<RestaurantType[]> {
    const result = await pool.query<RestaurantType>(
      `
      SELECT id, name, slug, active
      FROM public.restaurant_types
      WHERE active = TRUE
      ORDER BY name ASC
      `,
    );

    return result.rows;
  }
}
