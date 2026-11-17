import { ProductInputError, requiredText } from "../product/productValidation";
import { parseConfiguredProduct } from "../productTemplates/configuredProductInput";
import { GetAdminProductConfigurationService } from "../productTemplates/GetAdminProductConfigurationService";
import { moneyCents, moneyText } from "../order/orderValidation";
import type { PoolClient } from "pg";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProductInputError("Configuração do modelo inválida.", 422);
  return value as Record<string, unknown>;
}
function list(value: unknown, maximum = 100) {
  if (!Array.isArray(value) || value.length > maximum) throw new ProductInputError(`O modelo aceita até ${maximum} itens nesta lista.`, 422);
  return value.map(object);
}
function key(value: unknown) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) throw new ProductInputError("Chave local inválida no modelo.", 422);
  return value;
}
function keys(items: Record<string, unknown>[]) {
  const values = items.map(item => key(item.key));
  if (new Set(values).size !== values.length) throw new ProductInputError("Chaves locais duplicadas no modelo.", 422);
  return values;
}
function amount(value: unknown) {
  try { return moneyText(moneyCents(value)); }
  catch { throw new ProductInputError("Preço inválido no modelo.", 422); }
}
// Temporary IDs only for reusing configuration validation. Never persisted or taken from the source product.
const validationId = (index: number) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;

export function parsePrivateSnapshot(value: unknown) {
  const raw = object(value);
  if (raw.schemaVersion !== 1) throw new ProductInputError("Versão de configuração não suportada.", 422);
  const product = object(raw.product), variants = list(raw.variants), groups = list(raw.groups), limits = list(raw.variantGroupLimits, 10000);
  const variantKeys = keys(variants), groupKeys = keys(groups);
  const groupIds = new Map(groupKeys.map((item, index) => [item, validationId(index)]));
  const variantsByKey = new Set(variantKeys);
  const seen = new Set<string>();
  for (const limit of limits) {
    const pair = `${key(limit.variantKey)}:${key(limit.groupKey)}`;
    if (!variantsByKey.has(String(limit.variantKey)) || !groupIds.has(String(limit.groupKey)) || seen.has(pair)) {
      throw new ProductInputError("Limites duplicados ou vinculados a uma estrutura inexistente.", 422);
    }
    seen.add(pair);
  }
  const parsed = parseConfiguredProduct({
    name: product.name, description: product.description ?? null, available: true,
    groups: groups.map((group, index) => ({ ...group, id: validationId(index) })),
    variants: variants.map((variant, index) => ({ ...variant, id: validationId(index), price: amount(variant.price),
      groupLimits: limits.filter(limit => limit.variantKey === variantKeys[index]).map(limit => ({
        groupId: groupIds.get(String(limit.groupKey)), minSelect: limit.minSelect, maxSelect: limit.maxSelect,
      })),
    })),
  });
  const snapshot = {
    schemaVersion: 1 as const, product: { name: parsed.name, description: parsed.description },
    variants: parsed.variants.map((variant, index) => ({ key: variantKeys[index], name: variant.name, price: variant.price, available: variant.available })),
    groups: parsed.groups.map((group, index) => ({ key: groupKeys[index], name: group.name, required: group.required,
      minSelect: group.minSelect, maxSelect: group.maxSelect,
      options: (() => {
        const options = list(groups[index].options); const optionKeys = keys(options);
        return options.map((option, i) => {
          if (typeof option.available !== 'boolean') throw new ProductInputError("Disponibilidade de opção inválida.", 422);
          return { key: optionKeys[i], name: requiredText(option.name, 'Nome da opção'), additionalPrice: amount(option.additionalPrice), available: option.available };
        });
      })(),
    })),
    variantGroupLimits: parsed.variants.flatMap((variant, index) => variant.groupLimits.map(limit => ({
      variantKey: variantKeys[index], groupKey: groupKeys[parsed.groups.findIndex(group => group.id === limit.id)],
      minSelect: limit.minSelect, maxSelect: limit.maxSelect,
    }))),
  };
  if (Buffer.byteLength(JSON.stringify(snapshot)) > 1024 * 1024) throw new ProductInputError("O modelo excede 1 MiB.", 422);
  return snapshot;
}
export type PrivateSnapshot = ReturnType<typeof parsePrivateSnapshot>;

export async function snapshotOwnedProduct(client: PoolClient, restaurantId: string, productId: string) {
  const owned = await client.query("SELECT id FROM public.products WHERE id = $1 AND restaurant_id = $2 FOR UPDATE", [productId, restaurantId]);
  if (!owned.rows.length) throw new ProductInputError("Produto não encontrado.", 404);
  const config = await new GetAdminProductConfigurationService().execute({ restaurantId, productId }, client, true);
  if (!config) throw new ProductInputError("Produto não encontrado.", 404);
  const variantKeys = new Map(config.variants.map((variant, index) => [variant.id, `v${index + 1}`]));
  const groupKeys = new Map(config.groups.map((group, index) => [group.id, `g${index + 1}`]));
  return parsePrivateSnapshot({ schemaVersion: 1, product: { name: config.product.name, description: config.product.description },
    variants: config.variants.map(variant => ({ key: variantKeys.get(variant.id), name: variant.name, price: variant.price, available: variant.available })),
    groups: config.groups.map(group => ({ key: groupKeys.get(group.id), name: group.name, required: group.required,
      minSelect: group.minSelect, maxSelect: group.maxSelect,
      options: group.options.map((option, index) => ({ key: `o${index + 1}`, name: option.name, additionalPrice: String(option.additionalPrice), available: option.available })),
    })),
    variantGroupLimits: config.variants.flatMap(variant => variant.groupLimits.map(limit => ({
      variantKey: variantKeys.get(variant.id), groupKey: groupKeys.get(limit.groupId), minSelect: limit.minSelect, maxSelect: limit.maxSelect,
    }))),
  });
}

export async function materializePrivateSnapshot(client: PoolClient, restaurantId: string, snapshot: PrivateSnapshot) {
  const prices = snapshot.variants.filter(variant => variant.available).map(variant => moneyCents(variant.price));
  const minimum = prices.reduce((min, price) => price < min ? price : min);
  const { rows: [product] } = await client.query(`INSERT INTO public.products (restaurant_id, name, description, price, available, published)
    VALUES ($1, $2, $3, $4, TRUE, FALSE) RETURNING id, name, published, available`,
  [restaurantId, snapshot.product.name, snapshot.product.description, moneyText(minimum)]);
  const variantIds = new Map<string, string>(), groupIds = new Map<string, string>();
  for (const variant of snapshot.variants) {
    const { rows: [saved] } = await client.query(`INSERT INTO public.product_variants (product_id, name, price, available)
      VALUES ($1, $2, $3, $4) RETURNING id`, [product.id, variant.name, variant.price, variant.available]);
    variantIds.set(variant.key, saved.id);
  }
  for (const group of snapshot.groups) {
    const { rows: [saved] } = await client.query(`INSERT INTO public.product_option_groups (product_id, name, required, min_select, max_select)
      VALUES ($1, $2, $3, $4, $5) RETURNING id`, [product.id, group.name, group.required, group.minSelect, group.maxSelect]);
    groupIds.set(group.key, saved.id);
    for (const option of group.options) {
      await client.query(`INSERT INTO public.product_options (group_id, name, additional_price, available)
        VALUES ($1, $2, $3, $4)`, [saved.id, option.name, option.additionalPrice, option.available]);
    }
  }
  for (const limit of snapshot.variantGroupLimits) {
    await client.query(`INSERT INTO public.product_variant_group_limits (variant_id, group_id, min_select, max_select)
      VALUES ($1, $2, $3, $4)`, [variantIds.get(limit.variantKey), groupIds.get(limit.groupKey), limit.minSelect, limit.maxSelect]);
  }
  return { product };
}
