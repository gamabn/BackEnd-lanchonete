import type { PoolClient } from "pg";
import { productTransaction } from "../product/productTransaction";
import { ProductInputError } from "../product/productValidation";
import { productUuid } from "../productTemplates/configuredProductInput";

export async function privateTemplateTransaction<T>(restaurantId: string, execute: (client: PoolClient) => Promise<T>): Promise<T> {
  if (!productUuid.test(restaurantId)) throw new ProductInputError("Identidade administrativa inválida.", 401);
  try {
    return await productTransaction(async client => {
      // SET LOCAL context, parameterized and on the very same connection as all subsequent queries.
      await client.query("SELECT set_config('gama.restaurant_id', $1, true), set_config('row_security', 'on', true)", [restaurantId]);
      const { rows: [security] } = await client.query<{
        rolsuper: boolean; rolbypassrls: boolean; templates_rls: boolean; versions_rls: boolean;
      }>(`SELECT r.rolsuper, r.rolbypassrls,
        row_security_active('public.restaurant_product_templates'::regclass) AS templates_rls,
        row_security_active('public.restaurant_product_template_versions'::regclass) AS versions_rls
        FROM pg_catalog.pg_roles r WHERE r.rolname = current_user`);
      if (!security || security.rolsuper || security.rolbypassrls || !security.templates_rls || !security.versions_rls) {
        throw new ProductInputError("Modelos privados indisponíveis: a conexão deve usar uma role sujeita às políticas RLS nas duas tabelas.", 503);
      }
      return execute(client);
    });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === '42P01' || code === '42704') throw new ProductInputError("Modelos privados indisponíveis: a migration 002 ainda precisa ser aplicada e verificada.", 503);
    if (code === '42501') throw new ProductInputError("Modelos privados indisponíveis: verifique as permissões da role e as políticas RLS.", 503);
    throw error;
  }
}
