import { pool } from "../../database";

interface CreateFromTemplateRequest {
  restaurantId: string;
  templateSlug: string;
}

interface TemplateVariant {
  name: string;
  price: number;
}

interface TemplateGroup {
  name: string;
  required: boolean;
  minSelect: number;
  maxSelect: number;
  options: unknown[];
}

interface TemplateConfiguration {
  name: string;
  description?: string;
  variants: TemplateVariant[];
  optionGroups: TemplateGroup[];
  variantGroupLimits: Record<
    string,
    Record<string, { min: number; max: number }>
  >;
}

export class ProductTemplateError extends Error {
  constructor(
    message: string,
    public statusCode = 400,
  ) {
    super(message);
    this.name = "ProductTemplateError";
  }
}

export class CreateProductFromTemplateService {
  async execute({ restaurantId, templateSlug }: CreateFromTemplateRequest) {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Confirma que o restaurante autenticado existe.
      const restaurant = await client.query(
        `SELECT id FROM public.restaurants WHERE id = $1`,
        [restaurantId],
      );

      if (restaurant.rowCount !== 1) {
        throw new ProductTemplateError("Estabelecimento não encontrado.", 404);
      }

      // Busca a versão ativa do modelo.
      const templateResult = await client.query<{
        template_id: string;
        version: number;
        configuration: TemplateConfiguration;
      }>(
        `SELECT
           pt.id AS template_id,
           ptv.version,
           ptv.configuration
         FROM public.product_templates pt
         INNER JOIN public.product_template_versions ptv
           ON ptv.template_id = pt.id
         WHERE pt.slug = $1
           AND pt.active = TRUE
           AND ptv.active = TRUE`,
        [templateSlug],
      );

      if (templateResult.rowCount !== 1) {
        throw new ProductTemplateError("Modelo ativo não encontrado.", 404);
      }

      const template = templateResult.rows[0];
      const config = template.configuration;

      if (
        !config ||
        typeof config.name !== "string" ||
        !Array.isArray(config.variants) ||
        !Array.isArray(config.optionGroups) ||
        !config.variantGroupLimits ||
        typeof config.variantGroupLimits !== "object"
      ) {
        throw new ProductTemplateError("Configuração do modelo inválida.", 422);
      }

      if (config.variants.length === 0) {
        throw new ProductTemplateError(
          "O modelo precisa ter pelo menos um tamanho.",
          422,
        );
      }

      const initialPrice = Math.min(
        ...config.variants.map((variant) => Number(variant.price)),
      );

      if (!Number.isFinite(initialPrice) || initialPrice < 0) {
        throw new ProductTemplateError("Preço inicial inválido.", 422);
      }

      // Produto inicialmente não publicado.
      const productResult = await client.query<{
        id: string;
        name: string;
        published: boolean;
      }>(
        `INSERT INTO public.products
          (restaurant_id, name, description, price, available, published)
         VALUES ($1, $2, $3, $4, TRUE, FALSE)
         RETURNING id, name, published`,
        [restaurantId, config.name, config.description ?? null, initialPrice],
      );

      const product = productResult.rows[0];

      const variantIds = new Map<string, string>();

      // Cria tamanhos e preços.
      for (const variant of config.variants) {
        const price = Number(variant.price);

        if (!variant.name?.trim() || !Number.isFinite(price) || price < 0) {
          throw new ProductTemplateError("Variação inválida no modelo.", 422);
        }

        const result = await client.query<{ id: string }>(
          `INSERT INTO public.product_variants
            (product_id, name, price)
           VALUES ($1, $2, $3)
           RETURNING id`,
          [product.id, variant.name, price],
        );

        variantIds.set(variant.name, result.rows[0].id);
      }

      const groupIds = new Map<string, string>();

      // Cria grupos sem ingredientes.
      for (const group of config.optionGroups) {
        if (
          !group.name?.trim() ||
          !Number.isInteger(group.minSelect) ||
          !Number.isInteger(group.maxSelect) ||
          group.minSelect < 0 ||
          group.maxSelect < group.minSelect ||
          !Array.isArray(group.options) ||
          group.options.length !== 0
        ) {
          throw new ProductTemplateError(
            "Grupo de escolhas inválido no modelo.",
            422,
          );
        }

        const result = await client.query<{ id: string }>(
          `INSERT INTO public.product_option_groups
            (product_id, name, required, min_select, max_select)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [
            product.id,
            group.name,
            group.required,
            group.minSelect,
            group.maxSelect,
          ],
        );

        groupIds.set(group.name, result.rows[0].id);
      }

      // Cria os limites de cada grupo por tamanho.
      for (const [variantName, groups] of Object.entries(
        config.variantGroupLimits,
      )) {
        const variantId = variantIds.get(variantName);

        if (!variantId || !groups || typeof groups !== "object") {
          throw new ProductTemplateError(
            "Tamanho inválido nos limites do modelo.",
            422,
          );
        }

        for (const [groupName, limits] of Object.entries(groups)) {
          const groupId = groupIds.get(groupName);

          if (
            !groupId ||
            !limits ||
            !Number.isInteger(limits.min) ||
            !Number.isInteger(limits.max) ||
            limits.min < 0 ||
            limits.max < limits.min
          ) {
            throw new ProductTemplateError("Limites inválidos no modelo.", 422);
          }

          await client.query(
            `INSERT INTO public.product_variant_group_limits
              (variant_id, group_id, min_select, max_select)
             VALUES ($1, $2, $3, $4)`,
            [variantId, groupId, limits.min, limits.max],
          );
        }
      }

      await client.query("COMMIT");

      return {
        message: "Produto criado a partir do modelo.",
        product,
        template: {
          slug: templateSlug,
          version: template.version,
        },
        variantsCreated: variantIds.size,
        groupsCreated: groupIds.size,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
