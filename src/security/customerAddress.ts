export const ADDRESS_FIELDS = ["street", "number", "neighborhood", "city", "complement"] as const;
export type AddressField = typeof ADDRESS_FIELDS[number];
export type StoredAddress = Record<AddressField, string | null>;
export interface DeliveryAddress {
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  complement: string | null;
}
export interface AddressFieldLimit {
  maxLength: number;
  nullable: boolean;
  kind: "text" | "integer";
  integerMax?: string;
}
export type AddressLimits = Record<AddressField, AddressFieldLimit>;
export type AddressErrorKind = "invalid" | "unsupported" | "forbidden" | "conflict" | "error" | "region_changed";
export class CustomerAddressError extends Error {
  constructor(readonly kind: AddressErrorKind) { super("Operação de endereço indisponível."); }
}

export interface AddressColumn {
  column_name: string;
  data_type: string;
  character_maximum_length: number | null;
  is_nullable: string;
  is_generated: string;
  is_identity: string;
}

/** UI caps supplement, never replace, smaller limits declared by PostgreSQL. */
export function addressLimitsFromColumns(columns: AddressColumn[]): AddressLimits {
  const caps: Record<AddressField, number> = { street: 200, number: 32, neighborhood: 120, city: 120, complement: 200 };
  const limits: Partial<AddressLimits> = {};
  for (const field of ADDRESS_FIELDS) {
    const column = columns.find(item => item.column_name === field);
    if (!column || column.is_generated !== "NEVER" || column.is_identity !== "NO") throw new CustomerAddressError("unsupported");
    const integerRanges: Partial<Record<string, string>> = { smallint: "32767", integer: "2147483647", bigint: "9223372036854775807" };
    const integerMax = integerRanges[column.data_type];
    if (field === "number" && integerMax) {
      limits[field] = { maxLength: integerMax.length, nullable: column.is_nullable === "YES", kind: "integer", integerMax };
    } else {
      if (!["text", "character varying", "character"].includes(column.data_type) ||
          (column.character_maximum_length !== null && (!Number.isSafeInteger(column.character_maximum_length) || column.character_maximum_length < 1))) throw new CustomerAddressError("unsupported");
      limits[field] = { maxLength: Math.min(column.character_maximum_length ?? caps[field], caps[field]), nullable: column.is_nullable === "YES", kind: "text" };
    }
  }
  // Every field is checked and assigned above; keep the schema boundary fail-closed.
  const { street, number, neighborhood, city, complement } = limits;
  if (!street || !number || !neighborhood || !city || !complement) throw new CustomerAddressError("unsupported");
  return { street, number, neighborhood, city, complement };
}

export function normalizeAddressField(field: AddressField, value: unknown, limits: AddressLimits): string | null | undefined {
  const limit = limits[field];
  if (field === "complement" && (value === null || value === "")) return limit.nullable ? null : "";
  if (typeof value !== "string" || value.length > 4096 || /\p{C}/u.test(value)) return undefined;
  const text = value.normalize("NFC").trim().replace(/\p{Zs}+/gu, " ");
  if (!text || [...text].length > limit.maxLength || !/^[\p{L}\p{M}\p{N} .,'’():\/#ºª°&+\-]+$/u.test(text)) return undefined;
  if (/^(?:0|menu(?: inicial)?|voltar(?: ao carrinho)?|cancelar|confirmar(?: e salvar| endereço| nome)?|corrigir(?: endereço| nome)?|finalizar(?: pedido)?|alterar endereço|entrega|retirada(?: no estabelecimento)?|ver card[aá]pio|meus pedidos|[0-9]+ - .+)$/iu.test(text)) return undefined;
  if (field === "number") {
    if (limit.kind === "integer") {
      if (!/^[0-9]+$/.test(text) || !limit.integerMax || BigInt(text) < 1n || BigInt(text) > BigInt(limit.integerMax)) return undefined;
      return BigInt(text).toString();
    } else if (!/^(?:[0-9]+[\p{L}]?(?:[ /-][0-9\p{L}]+)*|s\/?n|sem n[uú]mero)$/iu.test(text)) return undefined;
  } else if (!/\p{L}/u.test(text)) return undefined;
  return text;
}

export function officialAddressNeighborhood(value: unknown, official: string, limits: AddressLimits): string | undefined {
  return value === official && Boolean(official.trim()) && !/\p{C}/u.test(official) &&
    [...official].length <= limits.neighborhood.maxLength && limits.neighborhood.kind === "text" ? official : undefined;
}

export function normalizeDeliveryAddress(value: unknown, limits: AddressLimits, officialNeighborhood?: string): DeliveryAddress | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(field => !ADDRESS_FIELDS.some(allowed => allowed === field))) return undefined;
  const street = normalizeAddressField("street", input.street, limits);
  const number = normalizeAddressField("number", input.number, limits);
  const neighborhood = officialNeighborhood === undefined ? normalizeAddressField("neighborhood", input.neighborhood, limits)
    : officialAddressNeighborhood(input.neighborhood, officialNeighborhood, limits);
  const city = normalizeAddressField("city", input.city, limits);
  const complement = normalizeAddressField("complement", input.complement, limits);
  if (typeof street !== "string" || typeof number !== "string" || typeof neighborhood !== "string" ||
      typeof city !== "string" || complement === undefined) return undefined;
  return { street, number, neighborhood, city, complement };
}

export function isStoredAddress(value: unknown): value is StoredAddress {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return ADDRESS_FIELDS.every(field => input[field] === null || typeof input[field] === "string") &&
    Object.keys(input).length === ADDRESS_FIELDS.length;
}

export function sameAddress(a: StoredAddress, b: StoredAddress): boolean {
  return ADDRESS_FIELDS.every(field => a[field] === b[field]);
}
