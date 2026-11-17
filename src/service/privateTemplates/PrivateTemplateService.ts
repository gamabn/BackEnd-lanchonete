import type { PoolClient } from "pg";
import { ProductInputError } from "../product/productValidation";
import { privateTemplateTransaction } from "./privateTemplateTransaction";
import { materializePrivateSnapshot, parsePrivateSnapshot, snapshotOwnedProduct } from "./privateTemplateSnapshot";

export interface TemplateMetadata { name: string; description: string }
export class PrivateTemplateService {
  private async owned(client: PoolClient, restaurantId: string, templateId: string) {
    const { rows: [template] } = await client.query(`SELECT id, name, description, active, updated_at
      FROM public.restaurant_product_templates WHERE id = $1 AND restaurant_id = $2 FOR UPDATE`, [templateId, restaurantId]);
    if (!template) throw new ProductInputError("Modelo não encontrado.", 404);
    return template;
  }
  private async current(client: PoolClient, restaurantId: string, templateId: string) {
    const result = await client.query(`SELECT version, configuration FROM public.restaurant_product_template_versions
      WHERE template_id = $1 AND restaurant_id = $2 AND active = TRUE`, [templateId, restaurantId]);
    if (result.rows.length !== 1) throw new ProductInputError("Modelo sem uma versão corrente válida.", 409);
    return result.rows[0];
  }
  private async insertVersion(client: PoolClient, restaurantId: string, templateId: string, version: number, configuration: unknown) {
    await client.query(`INSERT INTO public.restaurant_product_template_versions (template_id, restaurant_id, version, configuration, active)
      VALUES ($1, $2, $3, $4::jsonb, TRUE)`, [templateId, restaurantId, version, JSON.stringify(configuration)]);
  }
  list(restaurantId: string) {
    return privateTemplateTransaction(restaurantId, async client => {
      const { rows } = await client.query(`SELECT t.id, t.name, t.description, t.active, t.updated_at, v.version
        FROM public.restaurant_product_templates t
        LEFT JOIN public.restaurant_product_template_versions v
          ON v.template_id = t.id AND v.restaurant_id = t.restaurant_id AND v.active = TRUE
        WHERE t.restaurant_id = $1 ORDER BY t.name, t.id`, [restaurantId]);
      return rows.map(row => ({ ...row, source: 'private' as const }));
    });
  }
  create(restaurantId: string, productId: string, metadata: TemplateMetadata) {
    return privateTemplateTransaction(restaurantId, async client => {
      const snapshot = await snapshotOwnedProduct(client, restaurantId, productId);
      const { rows: [template] } = await client.query(`INSERT INTO public.restaurant_product_templates (restaurant_id, name, description)
        VALUES ($1, $2, $3) RETURNING id, name, description, active, updated_at`, [restaurantId, metadata.name, metadata.description]);
      await this.insertVersion(client, restaurantId, template.id, 1, snapshot);
      return { template: { ...template, version: 1, source: 'private' } };
    });
  }
  get(restaurantId: string, templateId: string) {
    return privateTemplateTransaction(restaurantId, async client => {
      const template = await this.owned(client, restaurantId, templateId);
      const current = await this.current(client, restaurantId, templateId);
      const { rows: versions } = await client.query(`SELECT version, active, created_at FROM public.restaurant_product_template_versions
        WHERE template_id = $1 AND restaurant_id = $2 ORDER BY version DESC`, [templateId, restaurantId]);
      return { template: { ...template, version: current.version, source: 'private' }, versions,
        configuration: parsePrivateSnapshot(current.configuration) };
    });
  }
  rename(restaurantId: string, templateId: string, metadata: TemplateMetadata) {
    return privateTemplateTransaction(restaurantId, async client => {
      await this.owned(client, restaurantId, templateId);
      const { rows: [template] } = await client.query(`UPDATE public.restaurant_product_templates SET name = $3, description = $4, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND restaurant_id = $2 RETURNING id, name, description, active, updated_at`, [templateId, restaurantId, metadata.name, metadata.description]);
      return { template };
    });
  }
  version(restaurantId: string, templateId: string, productId: string, expectedVersion: number) {
    return privateTemplateTransaction(restaurantId, async client => {
      // Same lock order as saving: product first, template second. All product writers lock the parent.
      const product = await client.query("SELECT id FROM public.products WHERE id = $1 AND restaurant_id = $2 FOR UPDATE", [productId, restaurantId]);
      if (!product.rows.length) throw new ProductInputError("Produto não encontrado.", 404);
      await this.owned(client, restaurantId, templateId);
      const current = await this.current(client, restaurantId, templateId);
      if (current.version !== expectedVersion) throw new ProductInputError("O modelo mudou. Recarregue os modelos antes de atualizar.", 409);
      if (current.version >= 2147483647) throw new ProductInputError("O limite de versões deste modelo foi atingido.", 409);
      const snapshot = await snapshotOwnedProduct(client, restaurantId, productId);
      await client.query(`UPDATE public.restaurant_product_template_versions SET active = FALSE
        WHERE template_id = $1 AND restaurant_id = $2 AND active = TRUE`, [templateId, restaurantId]);
      await this.insertVersion(client, restaurantId, templateId, current.version + 1, snapshot);
      await client.query("UPDATE public.restaurant_product_templates SET updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND restaurant_id = $2", [templateId, restaurantId]);
      return { version: current.version + 1 };
    });
  }
  remove(restaurantId: string, templateId: string) {
    return privateTemplateTransaction(restaurantId, async client => {
      await this.owned(client, restaurantId, templateId);
      await client.query("DELETE FROM public.restaurant_product_template_versions WHERE template_id = $1 AND restaurant_id = $2", [templateId, restaurantId]);
      await client.query("DELETE FROM public.restaurant_product_templates WHERE id = $1 AND restaurant_id = $2", [templateId, restaurantId]);
      return { message: "Modelo excluído. Os produtos criados a partir dele foram preservados." };
    });
  }
  copy(restaurantId: string, templateId: string, expectedVersion: number) {
    return privateTemplateTransaction(restaurantId, async client => {
      const template = await this.owned(client, restaurantId, templateId);
      if (!template.active) throw new ProductInputError("Modelo indisponível.", 404);
      const current = await this.current(client, restaurantId, templateId);
      if (current.version !== expectedVersion) throw new ProductInputError("O modelo mudou. Selecione novamente a versão atual.", 409);
      return materializePrivateSnapshot(client, restaurantId, parsePrivateSnapshot(current.configuration));
    });
  }
}
