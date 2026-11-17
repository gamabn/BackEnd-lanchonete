import { PRODUCT_FIELD_MAX_BYTES, ProductInputError, requiredText, normalizeProductCategory } from "../product/productValidation";

export const productUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fields(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProductInputError("Configuração inválida.");
  }
  return value as Record<string, unknown>;
}

function id(value: unknown) {
  if (typeof value !== "string" || !productUuid.test(value)) {
    throw new ProductInputError("ID inválido na configuração.");
  }
  return value.toLowerCase();
}

function flag(value: unknown) {
  if (typeof value !== "boolean") throw new ProductInputError("Valor de seleção inválido.");
  return value;
}

function limits(min: unknown, max: unknown) {
  if (typeof min !== "number" || typeof max !== "number" || !Number.isInteger(min) ||
      !Number.isInteger(max) || min < 0 || min > max || max > 100) {
    throw new ProductInputError("Informe limites inteiros entre 0 e 100, com mínimo menor ou igual ao máximo.");
  }
  return { minSelect: min, maxSelect: max };
}

function entries(value: unknown) {
  if (!Array.isArray(value)) throw new ProductInputError("Informe a lista de itens da configuração.");
  return value.map(fields);
}

function unique<T extends { id: string }>(items: T[]): T[] {
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw new ProductInputError("A configuração contém IDs repetidos.");
  }
  return items;
}

function variantPrice(value: unknown) {
  const price = typeof value === "string" ? value.trim().replace(",", ".") : "";
  if (!/^\d+(?:\.\d{1,2})?$/.test(price) || !Number.isFinite(Number(price))) {
    throw new ProductInputError("Informe um preço de tamanho não negativo, com até duas casas decimais.");
  }
  return price;
}

function descriptionText(value: unknown) {
  if (value !== null && (typeof value !== "string" || value.includes("\0") || Buffer.byteLength(value) > PRODUCT_FIELD_MAX_BYTES)) {
    throw new ProductInputError("Descrição inválida.");
  }
  return (value as string | null)?.trim() || null;
}

export function parseConfiguredProduct(input: unknown) {
  const body = fields(input);
  const name = requiredText(body.name, "Nome");
  const description = descriptionText(body.description);
  const available = flag(body.available);
  const groups = unique(entries(body.groups).map((group) => {
    const required = flag(group.required);
    const bounds = limits(group.minSelect, group.maxSelect);
    if (required && bounds.minSelect === 0) {
      throw new ProductInputError("Grupos obrigatórios precisam de um mínimo de pelo menos uma escolha.");
    }
    return { id: id(group.id), name: requiredText(group.name, "Nome do grupo"), required, ...bounds };
  }));

  const variants = unique(entries(body.variants).map((variant) => {
    const price = variantPrice(variant.price);
    const groupLimits = unique(entries(variant.groupLimits).map((entry) => ({
      id: id(entry.groupId), ...limits(entry.minSelect, entry.maxSelect),
    })));
    const active = flag(variant.available);
    if (active && groupLimits.reduce((sum, entry) => sum + entry.minSelect, 0) > 100) {
      throw new ProductInputError("Cada tamanho ativo pode exigir no máximo 100 escolhas no total.");
    }
    return {
      id: id(variant.id), name: requiredText(variant.name, "Nome do tamanho"),
      price, available: active, groupLimits,
    };
  }));

  if (!variants.some((variant) => variant.available)) {
    throw new ProductInputError("Mantenha pelo menos um tamanho ativo para definir o preço do produto.");
  }

  const groupsById = new Map(groups.map((group) => [group.id, group]));
  for (const variant of variants) {
    if (variant.groupLimits.length !== groups.length) {
      throw new ProductInputError("Informe os limites de todos os grupos para cada tamanho.");
    }
    for (const entry of variant.groupLimits) {
      const group = groupsById.get(entry.id);
      if (!group) throw new ProductInputError("Grupo não encontrado na configuração.", 404);
      if (group.required && entry.minSelect === 0) {
        throw new ProductInputError("Um grupo obrigatório precisa de pelo menos uma escolha em cada tamanho.");
      }
    }
  }

  return { name, description, available, groups, variants, category: normalizeProductCategory(body.category) };
}

export type ConfiguredProductInput = ReturnType<typeof parseConfiguredProduct>;

// A first size keeps the existing has_variants contract usable throughout draft editing.
export function parseNewConfiguredProduct(input: unknown) {
  const body = fields(input);
  return { name: requiredText(body.name, "Nome"), description: descriptionText(body.description ?? null),
    category: normalizeProductCategory(body.category),
    variantName: requiredText(body.variantName, "Nome do tamanho"), price: variantPrice(body.price) };
}
export type NewConfiguredProductInput = ReturnType<typeof parseNewConfiguredProduct>;

export function parseStructureChange(input: unknown) {
  const body = fields(input);
  if (body.action === 'removeGroup' || body.action === 'removeVariant') {
    return { action: body.action, id: id(body.id) } as const;
  }
  if (body.action === 'addGroup') {
    const required = flag(body.required);
    const bounds = limits(body.minSelect, body.maxSelect);
    if (required && bounds.minSelect === 0) throw new ProductInputError('Grupo obrigatório precisa exigir uma escolha.');
    return { action: body.action, name: requiredText(body.name, 'Nome do grupo'), required, ...bounds } as const;
  }
  if (body.action === 'addVariant') {
    return { action: body.action, name: requiredText(body.name, 'Nome do tamanho'), price: variantPrice(body.price) } as const;
  }
  throw new ProductInputError('Operação de estrutura inválida.');
}
export type StructureChange = ReturnType<typeof parseStructureChange>;
