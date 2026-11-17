import { GetIdStoreService } from "../../service/user/GetIdStoreService";
import type { PickupStoreReader } from "./pickup";

export const INITIAL_MENU_OPTIONS = "1 - Ver cardápio\n2 - Meus pedidos\n0 - Menu inicial";

function textField(value: unknown, numeric = false): string | undefined {
  if (typeof value !== "string" && !(numeric && typeof value === "number" && Number.isFinite(value))) return;
  const text = String(value).trim();
  if (!text || /^(null|undefined|\[object Object\])$/i.test(text) || /[\x00-\x1f\x7f]/.test(text)) return;
  return text;
}

/** Only presentation: the caller must first validate restaurant identity and availability. */
export function buildInitialMenu(store: Record<string, unknown>): string {
  const name = textField(store.name);
  const street = textField(store.street), number = textField(store.number, true);
  const neighborhood = textField(store.neighborhood), city = textField(store.city);
  const address = [street, number].filter(Boolean).join(", ");
  const location = [
    ...(address ? [`📍 ${address}`] : []),
    ...(neighborhood ? [`Bairro: ${neighborhood}`] : []),
    ...(city ? [`Cidade: ${city}`] : []),
  ];
  return [
    "👋 Olá! Seja bem-vindo(a)!", "",
    ...(name ? [`🍽️ *${name}*`, ""] : []),
    ...(location.length ? [...location, ""] : []),
    "Como podemos ajudar você hoje?", "", INITIAL_MENU_OPTIONS,
  ].join("\n");
}

interface MenuResult { available: boolean; reply: string }

/** Instance-local, restaurant-scoped cache; only successful reads live for 30 seconds. */
export class InitialMenu {
  private readonly cache = new Map<string, { expiresAt: number; result: MenuResult }>();
  private readonly pending = new Map<string, Promise<MenuResult>>();
  constructor(
    private readonly reader: PickupStoreReader = new GetIdStoreService(),
    private readonly now: () => number = Date.now,
  ) {}

  async load(restaurantId: string): Promise<MenuResult> {
    const cached = this.cache.get(restaurantId);
    if (cached && cached.expiresAt > this.now()) return cached.result;
    this.cache.delete(restaurantId);
    const pending = this.pending.get(restaurantId);
    if (pending) return pending;
    const request = this.read(restaurantId);
    this.pending.set(restaurantId, request);
    try { return await request; }
    finally { this.pending.delete(restaurantId); }
  }

  async reply(restaurantId: string): Promise<string> {
    return (await this.load(restaurantId)).reply;
  }

  private async read(restaurantId: string): Promise<MenuResult> {
    try {
      const store = await this.reader.execute(restaurantId);
      if (!store || typeof store !== "object" || !("id" in store) || store.id !== restaurantId || !("status" in store) || store.status !== true) {
        return { available: false, reply: "O restaurante está indisponível para atendimento no momento. Tente novamente mais tarde." };
      }
      const result = { available: true, reply: buildInitialMenu(store as Record<string, unknown>) };
      // Bound memory without allowing permanently stale entries.
      if (this.cache.size >= 200) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(restaurantId, { expiresAt: this.now() + 30_000, result });
      return result;
    } catch {
      process.stderr.write("[bot:initial_menu] motivo=RESTAURANT_LOOKUP_ERROR\n");
      return { available: false, reply: "Não foi possível consultar o restaurante agora. Tente novamente em instantes." };
    }
  }
}
