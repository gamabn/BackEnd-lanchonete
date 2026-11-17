import {
  bairroService,
  type ListedBairro,
} from "../../service/bairro/bairroService";
import { deliveryFee } from "../../security/deliveryFee";
export { deliveryFee } from "../../security/deliveryFee";
import type { StoredAddress } from "../../security/customerAddress";

export interface DeliveryRegion {
  bairro_id: string;
  bairro: string;
  fee: string;
  restaurant_id: string;
  fulfillment_mode: "DELIVERY";
}
export interface DeliveryRegionSelection extends DeliveryRegion {
  confirmed: boolean;
  customer_id: string;
  address: StoredAddress;
}
export type RegionLookupResult =
  | { kind: "found"; region: DeliveryRegion }
  | { kind: "not_found"; options: readonly DeliveryRegion[] }
  | { kind: "ambiguous" | "invalid" | "error" };
export type RegionListResult =
  | { kind: "listed"; options: readonly DeliveryRegion[] }
  | { kind: "invalid" | "error" };
export interface RegionCatalog {
  list(restaurantId: string): Promise<RegionListResult>;
  resolve(restaurantId: string, bairroId: string): Promise<RegionLookupResult>;
  lookup(
    restaurantId: string,
    neighborhood: string,
  ): Promise<RegionLookupResult>;
}

function readRegion(
  row: ListedBairro,
  restaurantId: string,
): DeliveryRegion | undefined {
  const fee = deliveryFee(row.frete);
  if (
    fee === undefined ||
    typeof row.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      row.id,
    ) ||
    typeof row.bairro !== "string" ||
    !row.bairro.trim() ||
    row.bairro.length > 200 ||
    /\p{C}/u.test(row.bairro)
  )
    return undefined;
  return {
    bairro_id: row.id,
    bairro: row.bairro,
    fee,
    restaurant_id: restaurantId,
    fulfillment_mode: "DELIVERY",
  };
}

export function formatDeliveryFee(fee: string): string {
  if (fee === "0.00") return "GRÁTIS";
  const [whole, cents] = fee.split(".");
  return `R$ ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${cents}`;
}

export class ExistingRegionCatalog implements RegionCatalog {
  constructor(
    private readonly reader: Pick<
      bairroService,
      "getBairro"
    > = new bairroService(),
  ) {}

  async list(restaurantId: string): Promise<RegionListResult> {
    if (!restaurantId.trim()) return { kind: "error" };
    try {
      const rows = await this.reader.getBairro(restaurantId);
      if (!Array.isArray(rows)) return { kind: "error" };
      const scoped = rows.filter(
        (row) => row && row.lanchonete_id === restaurantId,
      );
      if (new Set(scoped.map((row) => row.id)).size !== scoped.length)
        return { kind: "invalid" };
      return {
        kind: "listed",
        options: scoped.flatMap((row) => {
          const valid = readRegion(row, restaurantId);
          return valid ? [valid] : [];
        }),
      };
    } catch {
      return { kind: "error" };
    }
  }

  async resolve(
    restaurantId: string,
    bairroId: string,
  ): Promise<RegionLookupResult> {
    const listing = await this.list(restaurantId);
    if (listing.kind !== "listed") return listing;
    const chosen = listing.options.find(
      (region) => region.bairro_id === bairroId,
    );
    if (!chosen) return { kind: "not_found", options: listing.options };
    const result = await this.lookup(restaurantId, chosen.bairro);
    return result.kind === "found" && result.region.bairro_id !== bairroId
      ? { kind: "invalid" }
      : result;
  }

  async lookup(
    restaurantId: string,
    neighborhood: string,
  ): Promise<RegionLookupResult> {
    if (!restaurantId.trim() || !neighborhood) return { kind: "error" };
    try {
      const rows = await this.reader.getBairro(restaurantId, neighborhood);
      if (!Array.isArray(rows)) return { kind: "error" };
      const scoped = rows.filter(
        (row) => row && row.lanchonete_id === restaurantId,
      );
      if (scoped.some((row) => typeof row.matches_address !== "boolean"))
        return { kind: "invalid" };
      // Count all equivalent names before validating fees. Invalid prices cannot hide duplicates.
      const matches = scoped.filter((row) => row.matches_address === true);
      if (matches.length > 1) return { kind: "ambiguous" };
      if (new Set(scoped.map((row) => row.id)).size !== scoped.length)
        return { kind: "invalid" };
      if (matches.length === 1) {
        const valid = readRegion(matches[0], restaurantId);
        return valid ? { kind: "found", region: valid } : { kind: "invalid" };
      }
      return {
        kind: "not_found",
        options: scoped.flatMap((row) => {
          const valid = readRegion(row, restaurantId);
          return valid ? [valid] : [];
        }),
      };
    } catch {
      return { kind: "error" };
    }
  }
}

export const REGION_PAGE_SIZE = 10;
export function regionPreview(region: DeliveryRegion): string {
  return [
    "🚚 ENTREGA DISPONÍVEL",
    "",
    `Bairro: ${region.bairro}`,
    `Taxa de entrega: ${formatDeliveryFee(region.fee)}`,
    "",
    "1 - Confirmar região de entrega",
    "C - Corrigir dados do endereço",
    "B - Escolher outro bairro",
    "0 - Voltar ao carrinho",
  ].join("\n");
}

export function regionConfirmed(region: DeliveryRegion): string {
  return [
    "✅ REGIÃO DE ENTREGA CONFIRMADA!",
    "",
    `🏘️ Bairro: ${region.bairro}`,
    `🚚 Taxa de entrega: ${formatDeliveryFee(region.fee)}`,
    "",
    "ℹ️ O frete é uma prévia e será recalculado pelo backend na criação do pedido.",
    "",
    "💳 ESCOLHA A FORMA DE PAGAMENTO",
    "",
    "1 - PIX",
    "2 - Dinheiro",
    "3 - Cartão de débito",
    "4 - Cartão de crédito",
    "",
    "0 - Voltar ao carrinho",
  ].join("\n");
}

export function regionChoiceList(
  options: readonly DeliveryRegion[],
  page = 0,
): string {
  const start = page * REGION_PAGE_SIZE;
  return [
    "🚚 ESCOLHA SEU BAIRRO",
    "",
    ...options
      .slice(start, start + REGION_PAGE_SIZE)
      .map(
        (region, index) =>
          `${start + index + 1} - ${region.bairro} — ${formatDeliveryFee(region.fee)}`,
      ),
    ...(options.length === 0
      ? ["Nenhuma região com taxa válida está disponível para seleção."]
      : []),
    "",
    ...(start + REGION_PAGE_SIZE < options.length
      ? ["N - Próximas regiões"]
      : []),
    ...(page > 0 ? ["A - Regiões anteriores"] : []),
    "R - Atualizar bairros",
    "0 - Voltar ao carrinho",
  ].join("\n");
}

export function regionFailure(kind: "ambiguous" | "invalid" | "error"): string {
  const text = {
    ambiguous:
      "⚠️ Encontramos mais de uma região equivalente. Não é possível confirmar a entrega até resolver a ambiguidade.",
    invalid:
      "⚠️ Os dados da região ou da taxa de entrega não permitem uma confirmação segura.",
    error: "⚠️ Não foi possível consultar as regiões de entrega agora.",
  }[kind];
  return (
    text +
    "\n\nR - Consultar novamente\nB - Escolher outro bairro\n0 - Voltar ao carrinho"
  );
}
