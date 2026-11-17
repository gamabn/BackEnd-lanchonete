import { normalizeProductCategory } from "./productValidation";
import { pool } from "../../database";

interface ProductData {
  product_id: string;
  category?: string | null;
  name?: string;
  description?: string;
  price?: string | number;
  image_url?: string;
  public_id?: string;
  restaurant_id: string;
  expectedPublicId?: string | null;
}

class EditProductService {
  async findOwned(product_id: string, restaurant_id: string) {
    const result = await pool.query<{ id: string; public_id: string | null; has_variants: boolean }>(
      `SELECT p.id, p.public_id,
              EXISTS (SELECT 1 FROM public.product_variants v WHERE v.product_id = p.id) AS has_variants
       FROM products p WHERE p.id = $1 AND p.restaurant_id = $2`,
      [product_id, restaurant_id],
    );
    return result.rows[0];
  }

  async execute({
    product_id,
    name,
    description,
    price,
    image_url,
    public_id,
    restaurant_id,
    expectedPublicId,
    category,
  }: ProductData) {
    const values: unknown[] = [name, description, price, image_url, public_id, product_id, restaurant_id];
    // A text-only edit preserves the current image, including concurrent replacements.
    const imageCondition = expectedPublicId === undefined
      ? ""
      : "AND public_id IS NOT DISTINCT FROM $8";
    if (expectedPublicId !== undefined) {
      values.push(expectedPublicId);
    }

    const normalizedCategory = normalizeProductCategory(category);
    const categorySet = normalizedCategory === undefined ? "" : `, category = $${values.push(normalizedCategory)}`;
    const product = await pool.query(
      `UPDATE products
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           price = CASE
             WHEN EXISTS (SELECT 1 FROM public.product_variants v WHERE v.product_id = products.id)
             THEN price
             ELSE COALESCE($3, price)
           END,
           image_url = COALESCE($4, image_url),
           public_id = COALESCE($5, public_id)
           ${categorySet}
       WHERE id = $6 AND restaurant_id = $7
       ${imageCondition}
       RETURNING *`,
      values,
    );

    return product.rows[0];
  }
}

export { EditProductService };
