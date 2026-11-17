import { pool } from "../../database";

interface ProductTemplate {
  id: string;
  slug: string;
  name: string;
  version: number;
}

export class ListProductTemplatesService {
  async execute(): Promise<ProductTemplate[]> {
    const result = await pool.query<ProductTemplate>(
      `
      SELECT
        pt.id,
        pt.slug,
        ptv.configuration ->> 'name' AS name,
        ptv.version
      FROM public.product_templates pt
      INNER JOIN public.product_template_versions ptv
        ON ptv.template_id = pt.id
      WHERE pt.active = TRUE
        AND ptv.active = TRUE
      ORDER BY name ASC
      `,
    );

    return result.rows;
  }
}
