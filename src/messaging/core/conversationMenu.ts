import type { PersistentWhatsAppCheckout } from "../checkout/whatsappPersistentCheckout";
import { CHECKOUT_UNAVAILABLE, checkoutSuccess, POST_CHECKOUT_OPTIONS } from "../checkout/checkoutReplies";
import { nextCheckoutScope } from "./nextCheckoutScope";
import { customerOrdersReply, createCustomerOrdersReader, type CustomerOrdersReader } from "./customerOrders";
import { CheckoutIntentConflict } from "../checkout/checkoutIdempotency";
import { LiveCheckoutSession, CheckoutSessionInvalidError } from "../checkout/checkoutSession";
import type { WhatsAppCheckoutSession } from "../checkout/checkoutAuthorization";
import type { RestaurantContext, ExternalIdentity } from "../contracts";
import { validateRestaurantContext, validateExternalIdentity, MessagingValidationError } from "../validation";

export interface ConversationTransport {
  readonly context: RestaurantContext;
  readonly sender: ExternalIdentity;
}

import { checkoutPaymentSnapshot } from "./checkoutSnapshot";
import { moneyCents, moneyText, OrderValidationError } from "../../service/order/orderValidation";
import { parseCashAmount, formatPaymentMoney, CASH_CHANGE_MENU } from "./payment";
import { InitialMenu } from "./initialMenu";
import { GetIdStoreService } from "../../service/user/GetIdStoreService";
import {
  pickupAddress,
  pickupPreview,
  pickupConfirmed,
  type PickupAddress,
  type PickupStoreReader,
} from "./pickup";
import {
  type CatalogCategory,
  type CatalogProduct,
  formatCategories,
  formatCategoryProducts,
  formatProductDetails,
  getCatalogProducts,
  groupProductsByCategory,
} from "./catalog";

import {
  type BotProductConfiguration,
  formatVariantMenu,
  getBotProductConfiguration,
} from "./productConfiguration";

import { validateBotSelection } from "./validateConfiguredSelection";
import { BotCart } from "./cart";
import {
  identifyCustomer,
  customerIdentificationReply,
  createCustomerReader,
  type CustomerReader,
  type CustomerLookupResult,
} from "./customerIdentification";
import {
  trustedWhatsAppPhone,
  type WhatsAppPhoneIdentity,
} from "../channels/whatsapp/phoneIdentity";
import { normalizeCustomerName } from "../../security/customerName";
import {
  registerCustomer,
  registrationReply,
  createCustomerWriter,
  type CustomerWriter,
  type RegistrationResult,
} from "./customerRegistration";
import { FULFILLMENT_MENU, type FulfillmentMode } from "./fulfillment";
import {
  normalizeAddressField,
  normalizeDeliveryAddress,
  officialAddressNeighborhood,
  sameAddress,
  type AddressField,
  type AddressLimits,
  type StoredAddress,
  type DeliveryAddress,
} from "../../security/customerAddress";
import {
  createAddressGateway,
  addressOwner,
  addressPrompt,
  addressSummary,
  addressErrorReply,
  ADDRESS_SAVED,
  ADDRESS_CONFIRMED,
  type AddressGateway,
} from "./customerAddress";
import {
  ExistingRegionCatalog,
  formatDeliveryFee,
  regionPreview,
  regionConfirmed,
  regionChoiceList,
  regionFailure,
  REGION_PAGE_SIZE,
  type RegionCatalog,
  type DeliveryRegion,
  type DeliveryRegionSelection,
} from "./deliveryRegions";

import {
  PAYMENT_MENU,
  parsePaymentMethod,
  paymentMethodLabel,
  type PaymentMethod,
} from "./payment";

type Step =
  | "MENU"
  | "POST_CHECKOUT"
  | "CUSTOMER_ORDERS"
  | "CATEGORIES"
  | "PRODUCTS"
  | "DETAILS"
  | "VARIANTS"
  | "VARIANT_DETAILS"
  | "OPTIONS"
  | "SUMMARY"
  | "CART"
  | "CART_REMOVE"
  | "CUSTOMER_IDENTIFICATION"
  | "CUSTOMER_LOOKUP"
  | "CUSTOMER_FOUND"
  | "CUSTOMER_NOT_FOUND"
  | "CUSTOMER_NAME"
  | "CUSTOMER_NAME_CONFIRM"
  | "CUSTOMER_NAME_CORRECT"
  | "CUSTOMER_REGISTERING"
  | "CUSTOMER_REGISTERED"
  | "CUSTOMER_REGISTRATION_ERROR"
  | "CUSTOMER_AMBIGUOUS"
  | "CUSTOMER_LOOKUP_ERROR"
  | "FULFILLMENT_CHOICE"
  | "PICKUP_LOADING"
  | "PICKUP_REVIEW"
  | "PICKUP_ERROR"
  | "FULFILLMENT_SELECTED"
  | "ADDRESS_LOADING"
  | "ADDRESS_EXISTING"
  | "ADDRESS_STREET"
  | "ADDRESS_NUMBER"
  | "ADDRESS_NEIGHBORHOOD"
  | "ADDRESS_CITY"
  | "ADDRESS_COMPLEMENT"
  | "ADDRESS_REVIEW"
  | "ADDRESS_SAVING"
  | "ADDRESS_CONFIRMED"
  | "ADDRESS_ERROR"
  | "DELIVERY_REGION_LOADING"
  | "DELIVERY_REGION_AVAILABLE"
  | "DELIVERY_REGION_NOT_FOUND"
  | "DELIVERY_REGION_GUIDANCE"
  | "DELIVERY_REGION_AMBIGUOUS"
  | "DELIVERY_REGION_INVALID"
  | "DELIVERY_REGION_ERROR"
  | "DELIVERY_REGION_CONFIRMED"
  | "DELIVERY_NEIGHBORHOOD_LOADING"
  | "DELIVERY_NEIGHBORHOOD_CHOICE"
  | "DELIVERY_NEIGHBORHOOD_ERROR"
  | "PAYMENT_SELECTION"
  | "PAYMENT_CHANGE"
  | "PAYMENT_CHANGE_AMOUNT"
  | "ORDER_REVIEW"
  | "ORDER_SIMULATED";

type BotVariant = BotProductConfiguration["variants"][number];

interface BotOption {
  id: string;
  name: string;
  additional_price: number | string;
}

interface BotGroupLimit {
  groupId: string;
  minSelect: number;
  maxSelect: number;
}

type BotGroup = BotProductConfiguration["groups"][number];

interface BotGroupLimit {
  groupId: string;
  minSelect: number;
  maxSelect: number;
}

interface BotGroupOption {
  id: string;
  name: string;
  additional_price: number | string;
}

interface SelectedGroupOptions {
  groupId: string;
  optionIds: string[];
}

interface ConversationState {
  step: Step;
  categories: CatalogCategory[];
  selectedCategory?: CatalogCategory;
  selectedProduct?: CatalogProduct;
  configuration?: BotProductConfiguration;
  selectedVariant?: BotVariant;
  selectedGroupIndex?: number;
  selectedOptions?: SelectedGroupOptions[];
  validatedSelection?: ValidatedSelection;
  cart: BotCart;
  whatsappPhone?: WhatsAppPhoneIdentity;
  customerId?: string;
  lookupResult?: CustomerLookupResult["kind"];
  revision?: number;
  identityGeneration?: number;
  checkoutSession?: LiveCheckoutSession;
  checkoutTransport?: ConversationTransport & { readonly identity?: WhatsAppPhoneIdentity };
  draftName?: string;
  draftPhone?: string;
  registrationResult?: RegistrationResult["kind"];
  fulfillmentMode?: FulfillmentMode;
  pickupAddress?: PickupAddress;
  pickupConfirmed?: boolean;
  addressOriginal?: StoredAddress;
  addressDraft?: Partial<DeliveryAddress>;
  addressLimits?: AddressLimits;
  addressCustomerId?: string;
  addressPhone?: string;
  addressConfirmed?: boolean;
  confirmedAddress?: DeliveryAddress;
  addressWasSaved?: boolean;
  addressError?: string;
  addressRegion?: DeliveryRegion;
  deliveryRegion?: DeliveryRegionSelection;
  regionOptions?: readonly DeliveryRegion[];
  regionPage?: number;
  regionHint?: DeliveryRegion;
  regionFailureKind?: "ambiguous" | "invalid" | "error";
  paymentMethod?: PaymentMethod;
  changeFor?: string;
  paymentContext?: string;
  checkoutScopeId?: string;
  completedOrderId?: string;
  completedCheckoutScope?: string;
}

function formatSelectedVariant(
  product: CatalogProduct,
  variant: BotVariant,
): string {
  const price = Number(variant.price).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  return [
    `🍱 *${product.name.toUpperCase()}*`,
    "",
    `Tamanho: ${variant.name}`,
    `Preço inicial: ${price}`,
    "",
    "✅ Tamanho selecionado!",
    "",
    "1 - Escolher ingredientes e adicionais",
    "0 - Voltar aos tamanhos",
  ].join("\n");
}

function formatGroupOptions(group: BotGroup, variant: BotVariant): string {
  const limit = variant.groupLimits.find(
    (item: any) => item.groupId === group.id,
  );

  if (!limit) {
    return "⚠️ Configuração incompleta para este grupo.";
  }

  // const options = group.options.map((option, index) => {
  const options = (group.options as BotOption[]).map((option, index) => {
    const adicional = Number(option.additional_price);

    const price =
      adicional > 0
        ? ` (+${adicional.toLocaleString("pt-BR", {
            style: "currency",
            currency: "BRL",
          })})`
        : "";

    return `${index + 1} - ${option.name}${price}`;
  });

  return [
    `🍽️ *${group.name.toUpperCase()}*`,
    "",
    `Escolha de ${limit.minSelect} a ${limit.maxSelect} opções:`,
    "",
    ...options,
    "",
    "Digite os números separados por vírgula.",
    "Exemplo: 1,2",
    ...(limit.minSelect === 0 ? ["Digite P para pular este grupo."] : []),
    "",
    "0 - Voltar",
  ].join("\n");
}

type ValidatedSelection = Awaited<ReturnType<typeof validateBotSelection>>;

function formatSelectionSummary(
  product: CatalogProduct,
  result: ValidatedSelection,
  hasGroups: boolean,
): string {
  const total = Number(result.item_price).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  const groups = new Map<string, string[]>();

  for (const option of result.options) {
    const current = groups.get(option.group_name) ?? [];

    const additionalPrice = Number(option.additional_price);

    const additional =
      additionalPrice > 0
        ? ` (+${additionalPrice.toLocaleString("pt-BR", {
            style: "currency",
            currency: "BRL",
          })})`
        : "";

    current.push(`- ${option.option_name}${additional}`);

    groups.set(option.group_name, current);
  }

  const ingredients = Array.from(groups.entries()).flatMap(
    ([groupName, options]) => ["", `*${groupName}*`, ...options],
  );

  return [
    `🍱 *RESUMO DO PRODUTO*`,
    "",
    `Produto: ${product.name}`,
    `Tamanho: ${result.variant_name}`,
    ...ingredients,
    "",
    `💰 *TOTAL: ${total}*`,
    "",
    "1 - Confirmar produto",
    ...(hasGroups ? ["2 - Alterar ingredientes"] : []),
    "0 - Voltar aos tamanhos",
  ].join("\n");
}

function formatCart(cart: BotCart): string {
  const items = cart.list();

  if (items.length === 0) {
    return [
      "🛒 *SEU CARRINHO ESTÁ VAZIO*",
      "",
      "1 - Ver cardápio",
      "0 - Menu inicial",
    ].join("\n");
  }

  const lines = items.flatMap((item, index) => {
    const unitCents = moneyCents(item.unitPrice);

    const subtotalCents = unitCents * BigInt(item.quantity);

    const subtotal = formatPaymentMoney(subtotalCents);

    return [
      `${index + 1} - ${item.productName}${
        item.variantName ? ` (${item.variantName})` : ""
      }`,
      `    Quantidade: ${item.quantity}`,
      `    Subtotal: ${subtotal}`,
      "",
    ];
  });

  const totalCents = items.reduce((total, item) => {
    const unitCents = moneyCents(item.unitPrice);

    return total + unitCents * BigInt(item.quantity);
  }, 0n);

  const total = formatPaymentMoney(totalCents);

  return [
    "🛒 *MEU CARRINHO*",
    "",
    ...lines,
    `💰 *Subtotal provisório: ${total}*`,
    "",
    "1 - Adicionar outro produto",
    "2 - Remover produto",
    "3 - Finalizar pedido",
    "0 - Voltar ao menu inicial",
  ].join("\n");
}

export class ConversationMenu {
  private readonly sessions = new Map<string, ConversationState>();

  constructor(
    private readonly customerReader: CustomerReader = createCustomerReader(),
    private readonly customerWriter: CustomerWriter = createCustomerWriter(),
    private readonly addressGateway: AddressGateway = createAddressGateway(),
    private readonly regionCatalog: RegionCatalog = new ExistingRegionCatalog(),
    private readonly pickupStoreReader: PickupStoreReader = new GetIdStoreService(),
    private readonly initialMenu: InitialMenu = new InitialMenu(
      pickupStoreReader,
    ),
    private readonly persistentCheckout?: PersistentWhatsAppCheckout,
    private readonly customerOrders: CustomerOrdersReader = createCustomerOrdersReader(),
    private readonly catalogReader: typeof getCatalogProducts = getCatalogProducts,
  ) {}

  private finishCheckout(state: ConversationState, orderId: string): string {
    state.completedCheckoutScope = this.currentCheckout(state).context.session_id;
    state.completedOrderId = orderId;
    this.clearAddress(state);
    this.clearPayment(state);
    state.fulfillmentMode = undefined;
    state.pickupAddress = undefined;
    state.pickupConfirmed = false;
    state.cart = new BotCart();
    state.step = "POST_CHECKOUT";
    return checkoutSuccess(orderId);
  }

  private nextPurchase(state: ConversationState, orderId: string): ConversationState {
    return {
      step: "MENU", categories: [], cart: new BotCart(), whatsappPhone: state.whatsappPhone,
      checkoutTransport: state.checkoutTransport, identityGeneration: 0,
      checkoutScopeId: nextCheckoutScope(this.currentCheckout(state).context.session_id, orderId),
    };
  }

  private async listCustomerOrders(state: ConversationState, restaurantId: string, identity?: WhatsAppPhoneIdentity): Promise<string> {
    state.step = "CUSTOMER_ORDERS";
    const revision = state.revision = (state.revision ?? 0) + 1;
    const binding = JSON.stringify([state.checkoutTransport, state.whatsappPhone]);
    const reply = await customerOrdersReply(restaurantId, identity, this.customerReader, this.customerOrders);
    if (state.revision !== revision || JSON.stringify([state.checkoutTransport, state.whatsappPhone]) !== binding)
      return "Sua identificação ou conversa mudou. Volte ao menu principal.\n\n0 - Menu principal";
    return reply;
  }

  /** Follow existing completed purchases after restart; never register a child while browsing. */
  private async resumeConversation(state: ConversationState, sessionKey: string) {
    let owner = state;
    let resumed = await this.persistentCheckout!.resume(owner, () => this.currentCheckout(owner), n => { owner.identityGeneration = n; });
    const visited = new Set<string>();
    while (resumed.kind === "completed") {
      const parent = owner, completed = resumed;
      if (visited.has(completed.orderId)) break;
      visited.add(completed.orderId);
      const child = this.nextPurchase(parent, completed.orderId);
      this.sessions.set(sessionKey, child);
      const next = await this.persistentCheckout!.resume(child, () => this.currentCheckout(child), n => { child.identityGeneration = n; });
      if (next.kind === "ready" || next.kind === "unavailable") {
        this.sessions.set(sessionKey, parent);
        return { state: parent, resumed: completed };
      }
      owner = child;
      resumed = next;
    }
    return { state: owner, resumed };
  }

  private async loadPickup(
    state: ConversationState,
    restaurantId: string,
    confirm = false,
  ): Promise<string> {
    const previous = state.pickupAddress;

    state.pickupConfirmed = false;
    state.pickupAddress = undefined;
    state.step = "PICKUP_LOADING";

    const revision = (state.revision = (state.revision ?? 0) + 1);

    const fail = (message: string): string => {
      state.step = "PICKUP_ERROR";
      return message + "\n\n1 - Consultar novamente\n0 - Voltar ao carrinho";
    };
    try {
      const store = await this.pickupStoreReader.execute(restaurantId);
      if (state.revision !== revision) return formatCart(state.cart);
      if (
        !store ||
        typeof store !== "object" ||
        !("id" in store) ||
        store.id !== restaurantId
      )
        return fail("O restaurante não está disponível para retirada.");
      // Same availability rule used by OrderSalesService.
      if (!("status" in store) || store.status !== true)
        return fail(
          "O restaurante está indisponível para retirada no momento.",
        );
      const address = pickupAddress(
        store as Record<string, unknown>,
        restaurantId,
      );
      if (!address)
        return fail(
          "O endereço para retirada está indisponível. Entre em contato com o restaurante.",
        );
      state.pickupAddress = address;
      if (
        confirm &&
        previous &&
        JSON.stringify(previous) === JSON.stringify(address)
      ) {
        state.pickupConfirmed = true;
        this.clearPayment(state);
        state.step = "PAYMENT_SELECTION";
        return pickupConfirmed(address);
      }
      state.step = "PICKUP_REVIEW";
      return (
        (confirm
          ? "Os dados para retirada foram atualizados. Confira e confirme novamente.\n\n"
          : "") + pickupPreview(address)
      );
    } catch {
      if (state.revision !== revision) return formatCart(state.cart);
      return fail(
        "Não foi possível consultar o restaurante agora. Tente novamente.",
      );
    }
  }

  private clearPayment(state: ConversationState): void {
    state.checkoutSession?.invalidate();
    state.paymentMethod = undefined;
    state.changeFor = undefined;
    state.paymentContext = undefined;
  }

  private paymentSnapshot(state: ConversationState, restaurantId: string): string | undefined {
    return checkoutPaymentSnapshot(state, restaurantId);
  }

  private orderTotal(state: ConversationState): bigint {
    return state.cart.list().reduce((sum, item) => sum + moneyCents(item.unitPrice) * BigInt(item.quantity), 0n) +
      (state.fulfillmentMode === "DELIVERY" ? moneyCents(state.deliveryRegion!.fee) : 0n);
  }

  private async reviewOrder(state: ConversationState): Promise<string> {
    const items = state.cart.list();
    const subtotal = items.reduce((sum, item) => sum + moneyCents(item.unitPrice) * BigInt(item.quantity), 0n);
    const address = state.fulfillmentMode === "PICKUP" ? state.pickupAddress! : state.confirmedAddress!;
    state.step = "ORDER_REVIEW";
    if (this.persistentCheckout) {
      if (!await this.persistentCheckout.prepare(state, () => this.currentCheckout(state))) return CHECKOUT_UNAVAILABLE;
    } else if (state.checkoutSession) {
      try { state.checkoutSession.presentReview(); }
      catch (error) {
        if (!(error instanceof CheckoutSessionInvalidError || error instanceof CheckoutIntentConflict ||
              error instanceof OrderValidationError || error instanceof MessagingValidationError)) throw error;
        state.checkoutSession.invalidate();
      }
    }
    return ["📋 REVISÃO DO PEDIDO", "", ...items.map(item =>
      `${item.quantity} x ${item.productName}${item.variantName ? ` (${item.variantName})` : ""} — ${formatPaymentMoney(moneyCents(item.unitPrice) * BigInt(item.quantity))}`),
      `Subtotal do carrinho: ${formatPaymentMoney(subtotal)}`,
      `Modalidade: ${state.fulfillmentMode === "PICKUP" ? "RETIRADA" : "ENTREGA"}`,
      ...(state.fulfillmentMode === "PICKUP" ? [`Restaurante: ${state.pickupAddress!.name}`] : []),
      `Endereço: ${address.street}, ${address.number} — ${address.neighborhood}, ${address.city}`,
      ...("complement" in address && address.complement ? [`Complemento: ${address.complement}`] : []),
      ...(state.fulfillmentMode === "DELIVERY" ? [`Taxa de entrega: ${formatPaymentMoney(moneyCents(state.deliveryRegion!.fee))}`] : []),
      `Total provisório: ${formatPaymentMoney(this.orderTotal(state))}`,
      `Pagamento: ${paymentMethodLabel(state.paymentMethod!)}`,
      ...(state.paymentMethod === "DINHEIRO" ? [state.changeFor ? `Troco para: ${formatPaymentMoney(moneyCents(state.changeFor))} (troco: ${formatPaymentMoney(moneyCents(state.changeFor) - this.orderTotal(state))})` : "Não precisa de troco"] : []),
      "", this.persistentCheckout ? "Confira os dados antes de confirmar o pedido." : "Valores provisórios. Confirmação apenas simulada nesta etapa.", "", "1 - Confirmar pedido", "0 - Voltar ao pagamento"].join("\n");
  }

  private clearRegion(state: ConversationState): void {
    this.clearPayment(state);
    state.deliveryRegion = undefined;
    state.regionOptions = undefined;
    state.regionPage = 0;
    state.regionHint = undefined;
    state.regionFailureKind = undefined;
  }

  private clearAddress(state: ConversationState): void {
    this.clearRegion(state);
    state.addressRegion = undefined;
    state.addressOriginal = undefined;
    state.addressDraft = undefined;
    state.addressLimits = undefined;
    state.addressCustomerId = undefined;
    state.addressPhone = undefined;
    state.addressConfirmed = false;
    state.confirmedAddress = undefined;
    state.addressWasSaved = false;
    state.addressError = undefined;
  }

  private addressSessionValid(state: ConversationState): boolean {
    return (
      state.fulfillmentMode === "DELIVERY" &&
      !state.cart.isEmpty() &&
      Boolean(
        state.customerId &&
        state.customerId === state.addressCustomerId &&
        trustedWhatsAppPhone(state.whatsappPhone) === state.addressPhone &&
        state.addressPhone,
      )
    );
  }

  private addressValue(
    state: ConversationState,
    value: unknown,
    draft = false,
  ): DeliveryAddress | undefined {
    if (!state.addressLimits) return undefined;
    const exactOfficial =
      state.addressRegion &&
      (draft ||
        (typeof value === "object" &&
          value !== null &&
          "neighborhood" in value &&
          value.neighborhood === state.addressRegion.bairro));
    return normalizeDeliveryAddress(
      value,
      state.addressLimits,
      exactOfficial ? state.addressRegion?.bairro : undefined,
    );
  }

  private startAddressCollection(state: ConversationState): string {
    this.clearRegion(state);
    if (
      !state.addressLimits ||
      !state.addressRegion ||
      officialAddressNeighborhood(
        state.addressRegion.bairro,
        state.addressRegion.bairro,
        state.addressLimits,
      ) === undefined
    ) {
      return this.neighborhoodError(state, "invalid");
    }
    state.addressDraft = { neighborhood: state.addressRegion.bairro };
    state.addressConfirmed = false;
    state.confirmedAddress = undefined;
    state.step = "ADDRESS_STREET";
    return (
      `Bairro selecionado: ${state.addressRegion.bairro} — ${formatDeliveryFee(state.addressRegion.fee)}\n\n` +
      addressPrompt("street", state.addressLimits)
    );
  }

  private neighborhoodError(
    state: ConversationState,
    kind: "ambiguous" | "invalid" | "error",
  ): string {
    this.clearRegion(state);
    state.addressRegion = undefined;
    state.addressConfirmed = false;
    state.confirmedAddress = undefined;
    state.addressDraft = undefined;
    state.regionFailureKind = kind;
    state.step = "DELIVERY_NEIGHBORHOOD_ERROR";
    process.stdout.write(
      `[bot:delivery_region] motivo=${kind.toUpperCase()}\n`,
    );
    return regionFailure(kind);
  }

  private async chooseNeighborhood(
    state: ConversationState,
    restaurantId: string,
    notice = "",
  ): Promise<string> {
    if (!this.addressSessionValid(state))
      return this.failAddress(state, "forbidden");
    this.clearRegion(state);
    state.addressRegion = undefined;
    state.addressConfirmed = false;
    state.confirmedAddress = undefined;
    state.addressDraft = undefined;
    state.step = "DELIVERY_NEIGHBORHOOD_LOADING";
    const revision = (state.revision = (state.revision ?? 0) + 1);
    let result: Awaited<ReturnType<RegionCatalog["list"]>>;
    try {
      result = await this.regionCatalog.list(restaurantId);
    } catch {
      result = { kind: "error" };
    }
    if (state.revision !== revision) return formatCart(state.cart);
    if (result.kind !== "listed")
      return this.neighborhoodError(state, result.kind);
    state.regionOptions = result.options;
    state.regionPage = 0;
    state.step = "DELIVERY_NEIGHBORHOOD_CHOICE";
    return (notice ? notice + "\n\n" : "") + regionChoiceList(result.options);
  }

  private async selectNeighborhood(
    state: ConversationState,
    restaurantId: string,
    displayed: DeliveryRegion,
  ): Promise<string> {
    const owner = addressOwner(
      restaurantId,
      state.customerId,
      state.whatsappPhone,
    );
    if (!owner || !this.addressSessionValid(state))
      return this.failAddress(state, "forbidden");
    this.clearRegion(state);
    state.step = "DELIVERY_NEIGHBORHOOD_LOADING";
    const revision = (state.revision = (state.revision ?? 0) + 1);
    let selected: Awaited<ReturnType<RegionCatalog["resolve"]>>;
    try {
      selected = await this.regionCatalog.resolve(
        restaurantId,
        displayed.bairro_id,
      );
    } catch {
      selected = { kind: "error" };
    }
    if (state.revision !== revision) return formatCart(state.cart);
    if (selected.kind === "not_found")
      return this.chooseNeighborhood(
        state,
        restaurantId,
        "Esse bairro não está mais disponível. Escolha novamente.",
      );
    if (selected.kind !== "found")
      return this.neighborhoodError(state, selected.kind);
    if (
      selected.region.restaurant_id !== restaurantId ||
      selected.region.fulfillment_mode !== "DELIVERY"
    )
      return this.failAddress(state, "forbidden");
    if (
      selected.region.bairro !== displayed.bairro ||
      selected.region.fee !== displayed.fee
    ) {
      return this.chooseNeighborhood(
        state,
        restaurantId,
        "O bairro ou a taxa mudou. Confira a lista atual e escolha novamente.",
      );
    }
    let persisted: Awaited<ReturnType<AddressGateway["load"]>>;
    try {
      persisted = await this.addressGateway.load(owner);
    } catch {
      return state.revision === revision
        ? this.failAddress(state, "error")
        : formatCart(state.cart);
    }
    if (state.revision !== revision) return formatCart(state.cart);
    if (persisted.kind !== "loaded")
      return this.failAddress(state, persisted.kind);
    this.clearAddress(state);
    state.addressOriginal = persisted.address;
    state.addressLimits = persisted.limits;
    state.addressCustomerId = owner.customer_id;
    state.addressPhone = owner.phone;
    state.addressRegion = selected.region;
    return this.startAddressCollection(state);
  }

  private failAddress(
    state: ConversationState,
    kind: Parameters<typeof addressErrorReply>[0],
  ): string {
    this.clearAddress(state);
    state.step = "ADDRESS_ERROR";
    state.addressError = addressErrorReply(kind);
    return state.addressError;
  }

  private async loadAddress(
    state: ConversationState,
    restaurantId: string,
    confirmExisting = false,
    edit = false,
    forceNeighborhood = false,
  ): Promise<string> {
    const owner = addressOwner(
      restaurantId,
      state.customerId,
      state.whatsappPhone,
    );
    if (state.fulfillmentMode !== "DELIVERY" || !owner || state.cart.isEmpty())
      return this.failAddress(state, "forbidden");
    const expected = state.addressOriginal;
    const previousRegion = state.addressRegion;
    this.clearRegion(state);
    state.addressCustomerId = owner.customer_id;
    state.addressPhone = owner.phone;
    state.step = "ADDRESS_LOADING";
    const revision = (state.revision = (state.revision ?? 0) + 1);
    let result: Awaited<ReturnType<AddressGateway["load"]>>;
    try {
      result = await this.addressGateway.load(owner);
    } catch {
      return state.revision === revision
        ? this.failAddress(state, "error")
        : formatCart(state.cart);
    }
    if (state.revision !== revision) return formatCart(state.cart);
    if (result.kind !== "loaded") return this.failAddress(state, result.kind);
    this.clearAddress(state);
    state.addressOriginal = result.address;
    state.addressLimits = result.limits;
    state.addressCustomerId = owner.customer_id;
    state.addressPhone = owner.phone;
    if (forceNeighborhood || !result.address.neighborhood)
      return this.chooseNeighborhood(state, restaurantId);
    let match: Awaited<ReturnType<RegionCatalog["lookup"]>>;
    try {
      match =
        edit && previousRegion
          ? await this.regionCatalog.resolve(
              restaurantId,
              previousRegion.bairro_id,
            )
          : await this.regionCatalog.lookup(
              restaurantId,
              result.address.neighborhood,
            );
    } catch {
      match = { kind: "error" };
    }
    if (state.revision !== revision) return formatCart(state.cart);
    if (match.kind === "not_found")
      return this.chooseNeighborhood(
        state,
        restaurantId,
        "O bairro cadastrado não está entre as regiões atendidas. Escolha um bairro e confirme a correção do endereço.",
      );
    if (match.kind !== "found")
      return this.neighborhoodError(state, match.kind);
    if (
      match.region.restaurant_id !== restaurantId ||
      match.region.fulfillment_mode !== "DELIVERY"
    )
      return this.failAddress(state, "forbidden");
    state.addressRegion = match.region;
    const complete = this.addressValue(state, result.address);
    if (
      edit &&
      previousRegion &&
      expected &&
      sameAddress(expected, result.address)
    ) {
      if (
        previousRegion.bairro !== match.region.bairro ||
        previousRegion.fee !== match.region.fee
      ) {
        return this.chooseNeighborhood(
          state,
          restaurantId,
          "O bairro ou a taxa mudou. Escolha novamente antes de corrigir o endereço.",
        );
      }
      return this.startAddressCollection(state);
    }
    if (
      confirmExisting &&
      expected &&
      complete &&
      sameAddress(result.address, expected)
    ) {
      state.addressConfirmed = true;
      state.confirmedAddress = complete;
      state.step = "ADDRESS_CONFIRMED";
      return this.refreshRegions(state, restaurantId, {
        notice: ADDRESS_CONFIRMED,
      });
    }
    if (complete) {
      state.step = "ADDRESS_EXISTING";
      return (
        ((confirmExisting || edit) && expected
          ? "Confira o endereço atual e confirme novamente.\n\n"
          : "") + addressSummary(complete, true)
      );
    }
    return this.chooseNeighborhood(state, restaurantId);
  }

  private async saveAddress(
    state: ConversationState,
    restaurantId: string,
  ): Promise<string> {
    const owner = addressOwner(
      restaurantId,
      state.customerId,
      state.whatsappPhone,
    );
    const expected = state.addressOriginal;
    const selected = state.addressRegion;
    const address = this.addressValue(state, state.addressDraft, true);
    if (
      !owner ||
      !expected ||
      !selected ||
      !address ||
      !this.addressSessionValid(state)
    )
      return this.failAddress(state, "invalid");
    state.step = "ADDRESS_SAVING";
    const revision = (state.revision = (state.revision ?? 0) + 1);
    let current: Awaited<ReturnType<RegionCatalog["resolve"]>>;
    try {
      current = await this.regionCatalog.resolve(
        restaurantId,
        selected.bairro_id,
      );
    } catch {
      current = { kind: "error" };
    }
    if (state.revision !== revision) return formatCart(state.cart);
    if (current.kind === "not_found")
      return this.chooseNeighborhood(
        state,
        restaurantId,
        "O bairro deixou de estar disponível. Escolha novamente.",
      );
    if (current.kind !== "found")
      return this.neighborhoodError(state, current.kind);
    if (
      current.region.restaurant_id !== restaurantId ||
      current.region.bairro_id !== selected.bairro_id ||
      current.region.bairro !== selected.bairro ||
      current.region.fee !== selected.fee
    ) {
      return this.chooseNeighborhood(
        state,
        restaurantId,
        "O bairro ou a taxa mudou. Escolha novamente antes de salvar.",
      );
    }
    let result: Awaited<ReturnType<AddressGateway["save"]>>;
    try {
      result = await this.addressGateway.save(owner, expected, address, {
        bairro_id: selected.bairro_id,
        fee: selected.fee,
      });
    } catch {
      return state.revision === revision
        ? this.failAddress(state, "error")
        : formatCart(state.cart);
    }
    if (state.revision !== revision) return formatCart(state.cart);
    if (result.kind === "region_changed")
      return this.chooseNeighborhood(
        state,
        restaurantId,
        "O bairro ou a taxa mudou durante a confirmação. Escolha novamente.",
      );
    if (result.kind !== "saved") return this.failAddress(state, result.kind);
    state.addressOriginal = result.address;
    state.addressDraft = undefined;
    state.addressConfirmed = true;
    state.confirmedAddress = result.address;
    state.addressWasSaved = true;
    state.step = "ADDRESS_CONFIRMED";
    return this.refreshRegions(state, restaurantId, { notice: ADDRESS_SAVED });
  }

  private async refreshRegions(
    state: ConversationState,
    restaurantId: string,
    intent: { confirm?: boolean; check?: boolean; notice?: string } = {},
  ): Promise<string> {
    const owner = addressOwner(
      restaurantId,
      state.customerId,
      state.whatsappPhone,
    );
    if (
      !owner ||
      !this.addressSessionValid(state) ||
      !state.addressConfirmed ||
      !state.addressOriginal ||
      !state.confirmedAddress
    ) {
      return this.failAddress(state, "forbidden");
    }
    const original = { ...state.addressOriginal };
    const previous = state.deliveryRegion;
    this.clearRegion(state);
    state.step = "DELIVERY_REGION_LOADING";
    const revision = (state.revision = (state.revision ?? 0) + 1);
    let persisted: Awaited<ReturnType<AddressGateway["load"]>>;
    try {
      persisted = await this.addressGateway.load(owner);
    } catch {
      return state.revision === revision
        ? this.failAddress(state, "error")
        : formatCart(state.cart);
    }
    if (state.revision !== revision) return formatCart(state.cart);
    if (persisted.kind !== "loaded")
      return this.failAddress(state, persisted.kind);
    // Compare against the persisted snapshot, not the normalized display text.
    if (
      !sameAddress(persisted.address, original) ||
      !this.addressValue(state, persisted.address)
    ) {
      state.addressConfirmed = false;
      state.confirmedAddress = undefined;
      return this.loadAddress(state, restaurantId);
    }
    const neighborhood = persisted.address.neighborhood;
    if (!neighborhood) return this.failAddress(state, "invalid");
    let result: Awaited<ReturnType<RegionCatalog["lookup"]>>;
    try {
      result = await this.regionCatalog.lookup(restaurantId, neighborhood);
    } catch {
      result = { kind: "error" };
    }
    if (state.revision !== revision) return formatCart(state.cart);
    const notice = intent.notice
      ? intent.notice.replace(/\n\n0 - Voltar ao carrinho$/, "") + "\n\n"
      : "";
    if (result.kind === "found") {
      const quote = result.region;
      if (
        quote.restaurant_id !== restaurantId ||
        quote.fulfillment_mode !== "DELIVERY"
      )
        return this.failAddress(state, "forbidden");
      if (
        state.addressRegion &&
        state.addressRegion.bairro_id !== quote.bairro_id
      ) {
        return this.chooseNeighborhood(
          state,
          restaurantId,
          "A região cadastrada mudou. Escolha novamente.",
        );
      }
      state.addressRegion = quote;
      const unchanged =
        previous &&
        previous.customer_id === owner.customer_id &&
        previous.restaurant_id === restaurantId &&
        previous.bairro_id === quote.bairro_id &&
        previous.fee === quote.fee &&
        previous.bairro === quote.bairro &&
        sameAddress(previous.address, original);
      const confirmed = Boolean(
        unchanged && (intent.confirm || (intent.check && previous?.confirmed)),
      );
      state.deliveryRegion = {
        ...quote,
        customer_id: owner.customer_id,
        address: original,
        confirmed,
      };

      if (confirmed) {
        this.clearPayment(state);
        state.step = "PAYMENT_SELECTION";
        return regionConfirmed(quote);
      }

      state.step = "DELIVERY_REGION_AVAILABLE";
      /*state.step = confirmed
        ? "DELIVERY_REGION_CONFIRMED"
        : "DELIVERY_REGION_AVAILABLE";
      if (confirmed) return regionConfirmed(quote);*/

      const changed =
        previous && !unchanged
          ? "A região ou a taxa de entrega mudou. Confira e confirme novamente.\n\n"
          : "";
      return notice + changed + regionPreview(quote);
    }
    if (result.kind === "not_found") {
      return this.chooseNeighborhood(
        state,
        restaurantId,
        "O bairro do endereço não está entre as regiões atendidas. Escolha outro bairro para corrigir o endereço.",
      );
    }
    state.addressRegion = undefined;
    state.regionFailureKind = result.kind;
    state.step =
      result.kind === "ambiguous"
        ? "DELIVERY_REGION_AMBIGUOUS"
        : result.kind === "invalid"
          ? "DELIVERY_REGION_INVALID"
          : "DELIVERY_REGION_ERROR";
    process.stdout.write(
      `[bot:delivery_region] motivo=${result.kind.toUpperCase()}\n`,
    );
    return notice + regionFailure(result.kind);
  }

  private openFulfillmentMenu(state: ConversationState): string {
    state.pickupConfirmed = false;
    state.pickupAddress = undefined;
    this.clearPayment(state);
    if (state.cart.isEmpty()) {
      state.fulfillmentMode = undefined;
      state.step = "CART";
      return formatCart(state.cart);
    }
    if (!state.customerId || !trustedWhatsAppPhone(state.whatsappPhone)) {
      state.customerId = undefined;
      state.fulfillmentMode = undefined;
      state.step = "CUSTOMER_IDENTIFICATION";
      return customerIdentificationReply("unverified");
    }
    state.step = "FULFILLMENT_CHOICE";
    return FULFILLMENT_MENU;
  }

  private async confirmCustomerName(
    state: ConversationState,
    restaurantId: string,
  ): Promise<string> {
    const phone = trustedWhatsAppPhone(state.whatsappPhone);
    if (!phone || phone !== state.draftPhone || !state.draftName) {
      state.draftName = undefined;
      state.draftPhone = undefined;
      state.step = "CUSTOMER_IDENTIFICATION";
      return registrationReply("unverified");
    }
    state.step = "CUSTOMER_REGISTERING";
    const revision = (state.revision = (state.revision ?? 0) + 1);
    const result = await registerCustomer(
      restaurantId,
      state.whatsappPhone,
      state.draftName,
      this.customerWriter,
    );
    if (state.revision !== revision) return formatCart(state.cart);
    state.draftName = undefined;
    state.draftPhone = undefined;
    state.registrationResult = result.kind;
    switch (result.kind) {
      case "created":
        state.step = "CUSTOMER_REGISTERED";
        state.customerId = result.customerId;
        break;
      case "existing":
        state.step = "CUSTOMER_FOUND";
        state.customerId = result.customerId;
        state.lookupResult = "found";
        break;
      case "unverified":
        state.step = "CUSTOMER_IDENTIFICATION";
        break;
      case "ambiguous":
        state.step = "CUSTOMER_AMBIGUOUS";
        state.lookupResult = "ambiguous";
        break;
      default:
        state.step = "CUSTOMER_REGISTRATION_ERROR";
        break;
    }
    if (result.kind === "created" || result.kind === "existing") {
      const menu = this.openFulfillmentMenu(state);
      return result.kind === "created"
        ? "✅ Cadastro inicial concluído!\n\n" + menu
        : menu;
    }
    return registrationReply(result.kind);
  }

  private async lookupCustomer(
    state: ConversationState,
    restaurantId: string,
  ): Promise<string> {
    this.clearAddress(state);
    const previousCustomerId = state.customerId;
    state.customerId = undefined;
    state.lookupResult = undefined;
    state.draftName = undefined;
    state.draftPhone = undefined;
    state.registrationResult = undefined;
    state.step = "CUSTOMER_LOOKUP";
    const revision = (state.revision = (state.revision ?? 0) + 1);
    const result = await identifyCustomer(
      restaurantId,
      state.whatsappPhone,
      this.customerReader,
    );
    // A return to cart or newer message must not be overwritten by a late DB response.
    if (state.revision !== revision) return formatCart(state.cart);
    state.lookupResult = result.kind;
    if (
      result.kind !== "found" ||
      (previousCustomerId && previousCustomerId !== result.customerId)
    ) {
      state.fulfillmentMode = undefined;
    }
    switch (result.kind) {
      case "found":
        state.step = "CUSTOMER_FOUND";
        state.customerId = result.customerId;
        break;
      case "not_found":
        state.step = "CUSTOMER_NAME";
        break;
      case "ambiguous":
        state.step = "CUSTOMER_AMBIGUOUS";
        break;
      case "error":
        state.step = "CUSTOMER_LOOKUP_ERROR";
        break;
      case "unverified":
        state.step = "CUSTOMER_IDENTIFICATION";
        break;
    }
    if (result.kind === "found") return this.openFulfillmentMenu(state);
    return customerIdentificationReply(result.kind);
  }

  private currentCheckout(state: ConversationState): WhatsAppCheckoutSession {
    if (!state.checkoutTransport) throw new CheckoutSessionInvalidError();
    return { context: { ...state.checkoutTransport.context,
      session_id: state.checkoutScopeId ?? state.checkoutTransport.context.session_id }, sender: state.checkoutTransport.sender,
      transportIdentity: state.checkoutTransport.identity, identityRevision: state.identityGeneration ?? 0, checkout: state };
  }

  // Serialize whole menu transitions, including review registration and post-commit reply.
  private readonly checkoutQueues = new Map<string, Promise<unknown>>();
  async handle(...args: Parameters<ConversationMenu["handleMessage"]>): Promise<string> {
    if (!this.persistentCheckout) return this.handleMessage(...args);
    const key = JSON.stringify([args[1], args[0], args[3]]);
    const owner = this.sessions.get(key);
    const confirmingReview = args[2].trim() === "1" && owner?.step === "ORDER_REVIEW";
    const binding = JSON.stringify({ context: args[5]?.context, sender: args[5]?.sender, identity: args[4] });
    const previous = this.checkoutQueues.get(key) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(() => {
      // Two confirmations queued against one review must not reinterpret the second as "new order".
      if (confirmingReview && owner?.completedOrderId && JSON.stringify(owner.checkoutTransport) === binding)
        return checkoutSuccess(owner.completedOrderId);
      return this.handleMessage(...args);
    });
    this.checkoutQueues.set(key, task);
    try { return await task; }
    finally { if (this.checkoutQueues.get(key) === task) this.checkoutQueues.delete(key); }
  }

  private async handleMessage(
    key: string,
    restaurantId: string,
    text: string,
    senderJid: string,
    whatsappPhone?: WhatsAppPhoneIdentity,
    transport?: ConversationTransport,
  ): Promise<string> {
    const choice = text.trim();
    if (transport) {
      validateRestaurantContext(transport.context);
      validateExternalIdentity(transport.sender);
      if (transport.context.channel !== "whatsapp" || transport.sender.channel !== "whatsapp" ||
          transport.context.restaurant_id !== restaurantId || transport.sender.subject_id !== senderJid)
        throw new Error("Contexto de transporte incompatível com a conversa.");
    }

    const sessionKey = JSON.stringify([restaurantId, key, senderJid]);
    let state = this.sessions.get(sessionKey);

    const jidType = senderJid.endsWith("@s.whatsapp.net")
      ? "PHONE_JID"
      : senderJid.endsWith("@lid")
        ? "LID"
        : "UNKNOWN";

    process.stdout.write(`[bot:sender] tipo=${jidType}\n`);

    if (!state) {
      state = {
        step: "MENU",
        categories: [],
        cart: new BotCart(),
      };
      this.sessions.set(sessionKey, state);
    }

    const pending = state.checkoutSession?.status.phase === "SUBMISSION_PENDING";
    if (transport || state.checkoutTransport) {
      const observed = transport ? {
        context: { ...transport.context }, sender: { ...transport.sender },
        identity: whatsappPhone ? { ...whatsappPhone } : undefined,
      } : undefined;
      if (state.checkoutTransport && JSON.stringify(state.checkoutTransport) !== JSON.stringify(observed)) {
        state.identityGeneration = (state.identityGeneration ?? 0) + 1;
        state.checkoutSession?.invalidate();
        state.completedOrderId = undefined;
        state.completedCheckoutScope = undefined;
      }
      state.checkoutTransport = observed;
      if (observed && !state.checkoutSession) {
        const owner = state;
        state.checkoutSession = new LiveCheckoutSession((): WhatsAppCheckoutSession => {
          if (this.sessions.get(sessionKey) !== owner || !owner.checkoutTransport) throw new CheckoutSessionInvalidError();
          return this.currentCheckout(owner);
        });
      }
    }
    if (choice === "0" && !pending) state.revision = (state.revision ?? 0) + 1;
    if (whatsappPhone) {
      if (
        state.whatsappPhone &&
        state.whatsappPhone.phone !== whatsappPhone.phone
      ) {
        state.revision = (state.revision ?? 0) + 1;
        state.customerId = undefined;
        state.lookupResult = undefined;
        state.draftName = undefined;
        state.draftPhone = undefined;
        state.registrationResult = undefined;
        state.fulfillmentMode = undefined;
        state.pickupConfirmed = false;
        state.pickupAddress = undefined;
        this.clearPayment(state);
        this.clearAddress(state);
        if (
          state.step.startsWith("PAYMENT_") ||
          state.step.startsWith("ORDER_") ||
          state.step.startsWith("PICKUP_") ||
          state.step.startsWith("CUSTOMER_") ||
          state.step.startsWith("FULFILLMENT_") ||
          state.step.startsWith("ADDRESS_") ||
          state.step.startsWith("DELIVERY_REGION_") ||
          state.step.startsWith("DELIVERY_NEIGHBORHOOD_")
        )
          state.step = "CUSTOMER_IDENTIFICATION";
      }
      state.whatsappPhone = whatsappPhone;
    }

    if (state.step === "CUSTOMER_ORDERS" && /^(oi|olá|ola|menu|0)$/i.test(choice)) {
      state.step = "MENU";
      return this.initialMenu.reply(restaurantId);
    }
    if (this.persistentCheckout && !state.completedOrderId) {
      const recovery = await this.resumeConversation(state, sessionKey);
      state = recovery.state;
      const owner = state, resumed = recovery.resumed;
      if (resumed.kind === "completed") {
        const reply = this.finishCheckout(owner, resumed.orderId);
        if (/^(oi|olá|ola|menu|0)$/i.test(choice)) { owner.step = "MENU"; return this.initialMenu.reply(restaurantId); }
        if (choice === "2") return this.listCustomerOrders(owner, restaurantId, whatsappPhone);
        return reply;
      }
      if (resumed.kind === "review") {
        Object.assign(owner, resumed.checkout);
        return "Recuperamos seu checkout. Confira novamente antes de confirmar.\n\n" + await this.reviewOrder(owner);
      }
      if (resumed.kind === "unavailable" && (state.step.startsWith("ORDER_") || state.step.startsWith("PAYMENT_"))) return CHECKOUT_UNAVAILABLE;
    }
    if (state.completedOrderId) {
      if (/^(oi|olá|ola|menu|0)$/i.test(choice)) {
        state.step = "MENU";
        return this.initialMenu.reply(restaurantId);
      }
      if ((state.step === "POST_CHECKOUT" && (choice === "1" || choice === "3")) ||
          (state.step === "MENU" && choice === "1")) {
        const next = this.nextPurchase(state, state.completedOrderId);
        this.sessions.set(sessionKey, next);
        return this.handleMessage(key, restaurantId, "1", senderJid, whatsappPhone, transport);
      }
      if ((state.step === "POST_CHECKOUT" || state.step === "MENU") && choice === "2")
        return this.listCustomerOrders(state, restaurantId, whatsappPhone);
      if (state.step === "POST_CHECKOUT") return POST_CHECKOUT_OPTIONS;
    }
    state.checkoutSession?.refresh();
    if (pending) {
      // No navigation or replacement key while an attempt owns this review.
      return "Confirmação já simulada. Nenhum pedido foi criado.\n\n0 - Voltar ao pagamento";
    }

    if (state.paymentContext && state.paymentContext !== this.paymentSnapshot(state, restaurantId)) {
      this.clearPayment(state);
      return this.openFulfillmentMenu(state);
    }
    if (["PAYMENT_CHANGE", "PAYMENT_CHANGE_AMOUNT", "ORDER_REVIEW", "ORDER_SIMULATED"].includes(state.step)) {
      if (!state.paymentContext || !state.paymentMethod) return this.openFulfillmentMenu(state);
      if (choice === "0") {
        this.clearPayment(state);
        state.step = "PAYMENT_SELECTION";
        return PAYMENT_MENU;
      }
    }

    if (choice === "0" && state.step.startsWith("DELIVERY_NEIGHBORHOOD_")) {
      this.clearAddress(state);
      state.step = "CART";
      return formatCart(state.cart);
    }
    if (
      state.step.startsWith("DELIVERY_NEIGHBORHOOD_") &&
      !this.addressSessionValid(state)
    )
      return this.failAddress(state, "forbidden");
    if (choice === "0" && state.step.startsWith("DELIVERY_REGION_")) {
      state.regionOptions = undefined;
      state.regionHint = undefined;
      state.regionPage = 0;
      state.step = "CART";
      return formatCart(state.cart);
    }
    if (
      state.step.startsWith("DELIVERY_REGION_") &&
      (!this.addressSessionValid(state) || !state.addressConfirmed)
    ) {
      return this.failAddress(state, "forbidden");
    }
    if (choice === "0" && state.step.startsWith("ADDRESS_")) {
      this.clearAddress(state);
      state.step = "CART";
      return formatCart(state.cart);
    }
    if (
      state.step.startsWith("ADDRESS_") &&
      state.step !== "ADDRESS_ERROR" &&
      !this.addressSessionValid(state)
    ) {
      return this.failAddress(state, "forbidden");
    }
    if (
      choice.toUpperCase() === "B" &&
      [
        "ADDRESS_STREET",
        "ADDRESS_NUMBER",
        "ADDRESS_CITY",
        "ADDRESS_COMPLEMENT",
      ].includes(state.step)
    ) {
      return this.loadAddress(state, restaurantId, false, false, true);
    }

    // Navegação de retorno
    if (choice === "0") {
      switch (state.step) {
        case "VARIANT_DETAILS": {
          state.selectedVariant = undefined;

          if (!state.configuration) {
            state.step = "PRODUCTS";
            return state.selectedCategory
              ? formatCategoryProducts(state.selectedCategory)
              : await this.initialMenu.reply(restaurantId);
          }

          state.step = "VARIANTS";
          return formatVariantMenu(state.configuration);
        }

        case "VARIANTS":
        case "DETAILS": {
          state.step = "PRODUCTS";
          state.selectedProduct = undefined;
          state.selectedVariant = undefined;
          state.configuration = undefined;

          return state.selectedCategory
            ? formatCategoryProducts(state.selectedCategory)
            : await this.initialMenu.reply(restaurantId);
        }

        case "PRODUCTS": {
          state.step = "CATEGORIES";
          state.selectedCategory = undefined;
          state.selectedProduct = undefined;
          state.configuration = undefined;

          return formatCategories(state.categories);
        }

        case "OPTIONS": {
          state.step = "VARIANT_DETAILS";
          state.selectedGroupIndex = undefined;
          state.selectedOptions = [];

          return state.selectedProduct && state.selectedVariant
            ? formatSelectedVariant(
                state.selectedProduct,
                state.selectedVariant,
              )
            : await this.initialMenu.reply(restaurantId);
        }

        case "SUMMARY": {
          state.step = "VARIANTS";
          state.selectedVariant = undefined;
          state.selectedGroupIndex = undefined;
          state.selectedOptions = [];
          state.validatedSelection = undefined;

          return state.configuration
            ? formatVariantMenu(state.configuration)
            : await this.initialMenu.reply(restaurantId);
        }

        case "CART": {
          state.step = "MENU";
          return await this.initialMenu.reply(restaurantId);
        }

        case "CART_REMOVE": {
          state.step = "CART";
          return formatCart(state.cart);
        }

        case "PICKUP_LOADING":
        case "PICKUP_REVIEW":
        case "PICKUP_ERROR":
        case "FULFILLMENT_CHOICE":
        case "FULFILLMENT_SELECTED":
          state.step = "CART";
          return formatCart(state.cart);

        case "CUSTOMER_LOOKUP":
        case "CUSTOMER_FOUND":
        case "CUSTOMER_NOT_FOUND":
        case "CUSTOMER_NAME":
        case "CUSTOMER_NAME_CONFIRM":
        case "CUSTOMER_NAME_CORRECT":
        case "CUSTOMER_REGISTERING":
        case "CUSTOMER_REGISTERED":
        case "CUSTOMER_REGISTRATION_ERROR":
        case "CUSTOMER_AMBIGUOUS":
        case "CUSTOMER_LOOKUP_ERROR":
        case "CUSTOMER_IDENTIFICATION": {
          state.customerId = undefined;
          state.lookupResult = undefined;
          state.draftName = undefined;
          state.draftPhone = undefined;
          state.registrationResult = undefined;
          state.step = "CART";
          return formatCart(state.cart);
        }

        case "PAYMENT_SELECTION": {
          this.clearPayment(state);
          state.step = "CART";
          return formatCart(state.cart);
        }

        default: {
          state.step = "MENU";
          state.categories = [];
          state.selectedCategory = undefined;
          state.selectedProduct = undefined;
          state.selectedVariant = undefined;
          state.configuration = undefined;

          return await this.initialMenu.reply(restaurantId);
        }
      }
    }

    switch (state.step) {
      case "POST_CHECKOUT":
        state.step = "MENU";
        return this.initialMenu.reply(restaurantId);
      case "CUSTOMER_ORDERS":
        return "0 - Voltar ao menu principal";
      case "MENU": {
        const menu = await this.initialMenu.load(restaurantId);
        if (!menu.available) return menu.reply;
        if (choice === "1") {
          const products = await this.catalogReader(restaurantId);

          state.categories = groupProductsByCategory(products);
          state.step = "CATEGORIES";

          return formatCategories(state.categories);
        }

        if (choice === "2") {
          return this.listCustomerOrders(state, restaurantId, whatsappPhone);
        }

        return menu.reply;
      }

      case "SUMMARY": {
        const product = state.selectedProduct;
        const result = state.validatedSelection;

        if (!product || !result) {
          state.step = "MENU";
          return await this.initialMenu.reply(restaurantId);
        }
        //==========================================================
        /*  if (choice === "1") {
          return [
            "✅ Produto configurado com sucesso!",
            "",
            "Na próxima etapa vamos adicionar este produto ao carrinho.",
            "",
            "2 - Alterar ingredientes",
            "0 - Voltar aos tamanhos",
          ].join("\n");
        }*/
        //===========================================================

        if (choice === "1") {
          this.clearPayment(state);
          state.cart.add({
            productId: product.id,
            productName: product.name,
            quantity: 1,
            variantId: result.variant_id,
            variantName: result.variant_name,
            optionIds: (state.selectedOptions ?? []).flatMap(
              (selection) => selection.optionIds,
            ),
            unitPrice: result.item_price,
          });

          state.validatedSelection = undefined;
          state.selectedOptions = [];
          state.selectedGroupIndex = undefined;
          state.selectedVariant = undefined;
          state.configuration = undefined;
          state.selectedProduct = undefined;
          state.selectedCategory = undefined;

          state.step = "CART";

          return (
            "✅ Produto adicionado ao carrinho!\n\n" + formatCart(state.cart)
          );
        }

        // if (choice === "2") {
        if (choice === "2" && (state.configuration?.groups.length ?? 0) > 0) {
          state.step = "VARIANT_DETAILS";
          state.selectedGroupIndex = undefined;
          state.selectedOptions = [];
          state.validatedSelection = undefined;

          return "Vamos escolher novamente!\n\n1 - Escolher ingredientes\n0 - Voltar aos tamanhos";
        }

        return formatSelectionSummary(
          product,
          result,
          (state.configuration?.groups.length ?? 0) > 0,
        );
      }

      case "OPTIONS": {
        const configuration = state.configuration;
        const variant = state.selectedVariant;

        if (!configuration || !variant) {
          state.step = "MENU";
          return await this.initialMenu.reply(restaurantId);
        }

        const groupIndex = state.selectedGroupIndex ?? 0;
        const group = configuration.groups[groupIndex];

        if (!group) {
          return "⚠️ Grupo não encontrado.";
        }

        const limit = (variant.groupLimits as BotGroupLimit[]).find(
          (item) => item.groupId === group.id,
        );
        if (!limit) {
          return "⚠️ Configuração incompleta para este grupo.";
        }

        let optionIds: string[] = [];

        if (choice.toUpperCase() === "P" && limit.minSelect === 0) {
          optionIds = [];
        } else {
          const numbers = choice.split(",").map((item) => item.trim());

          if (numbers.some((number) => !/^[1-9]\d*$/.test(number))) {
            return (
              "❌ Digite números válidos separados por vírgula.\n\n" +
              formatGroupOptions(group, variant)
            );
          }

          const indexes = numbers.map((number) => Number(number) - 1);

          if (
            indexes.some(
              (index) => index < 0 || index >= group.options.length,
            ) ||
            new Set(indexes).size !== indexes.length
          ) {
            return (
              "❌ Opção inválida ou repetida.\n\n" +
              formatGroupOptions(group, variant)
            );
          }

          if (
            indexes.length < limit.minSelect ||
            indexes.length > limit.maxSelect
          ) {
            return (
              `❌ Escolha entre ${limit.minSelect} e ${limit.maxSelect} opções.\n\n` +
              formatGroupOptions(group, variant)
            );
          }

          optionIds = indexes.map((index) => group.options[index].id);
        }

        state.selectedOptions ??= [];

        state.selectedOptions.push({
          groupId: group.id,
          optionIds,
        });

        state.selectedGroupIndex = groupIndex + 1;

        const nextGroup = configuration.groups[state.selectedGroupIndex];

        if (nextGroup) {
          return formatGroupOptions(nextGroup, variant);
        }

        const selectedProduct = state.selectedProduct;

        if (!selectedProduct) {
          state.step = "MENU";
          return await this.initialMenu.reply(restaurantId);
        }

        const optionIdSelect = (state.selectedOptions ?? []).flatMap(
          (selection) => selection.optionIds,
        );

        try {
          const result = await validateBotSelection({
            restaurantId,
            productId: selectedProduct.id,
            variantId: variant.id,
            optionIds: optionIdSelect,
          });

          state.validatedSelection = result;
          state.step = "SUMMARY";

          return formatSelectionSummary(
            selectedProduct,
            result,
            (state.configuration?.groups.length ?? 0) > 0,
          );
        } catch (error) {
          state.step = "VARIANT_DETAILS";
          state.selectedGroupIndex = undefined;
          state.selectedOptions = [];

          return [
            "❌ Não foi possível validar os ingredientes selecionados.",
            "",
            "O cardápio pode ter sido atualizado.",
            "Volte e tente selecionar os ingredientes novamente.",
            "",
            "1 - Escolher ingredientes novamente",
            "0 - Voltar aos tamanhos",
          ].join("\n");
        }
      }

      case "CATEGORIES": {
        const index = Number(choice) - 1;

        if (
          !/^[1-9]\d*$/.test(choice) ||
          index < 0 ||
          index >= state.categories.length
        ) {
          return (
            "❌ Categoria inválida.\n\n" + formatCategories(state.categories)
          );
        }

        state.selectedCategory = state.categories[index];
        state.step = "PRODUCTS";

        return formatCategoryProducts(state.selectedCategory);
      }

      case "PRODUCTS": {
        const category = state.selectedCategory;

        if (!category) {
          state.step = "CATEGORIES";
          return formatCategories(state.categories);
        }

        const index = Number(choice) - 1;

        if (
          !/^[1-9]\d*$/.test(choice) ||
          index < 0 ||
          index >= category.products.length
        ) {
          return "❌ Produto inválido.\n\n" + formatCategoryProducts(category);
        }

        const product = category.products[index];

        state.selectedProduct = product;
        state.configuration = undefined;
        state.selectedVariant = undefined;

        // Produto simples
        if (!product.has_variants) {
          state.step = "DETAILS";

          return [
            `🍔 *${product.name.toUpperCase()}*`,
            "",
            `Preço: ${Number(product.price).toLocaleString("pt-BR", {
              style: "currency",
              currency: "BRL",
            })}`,
            "",
            "1 - Adicionar ao carrinho",
            "0 - Voltar aos produtos",
          ].join("\n");
        }

        // Produto configurável
        const configuration = await getBotProductConfiguration(
          restaurantId,
          product.id,
        );

        if (!configuration) {
          state.step = "PRODUCTS";
          state.selectedProduct = undefined;

          return (
            "⚠️ Produto indisponível no momento.\n\n" +
            formatCategoryProducts(category)
          );
        }

        state.configuration = configuration;
        state.step = "VARIANTS";

        return formatVariantMenu(configuration);
      }

      case "VARIANTS": {
        const configuration = state.configuration;
        const product = state.selectedProduct;

        if (!configuration || !product) {
          state.step = "PRODUCTS";
          return state.selectedCategory
            ? formatCategoryProducts(state.selectedCategory)
            : await this.initialMenu.reply(restaurantId);
        }

        //  if (!configuration) {
        // state.step = "PRODUCTS";
        //  return state.selectedCategory
        //    ? formatCategoryProducts(state.selectedCategory)
        ////   : await this.initialMenu.reply(restaurantId);
        //  }

        const index = Number(choice) - 1;

        if (
          !/^[1-9]\d*$/.test(choice) ||
          index < 0 ||
          index >= configuration.variants.length
        ) {
          return "❌ Tamanho inválido.\n\n" + formatVariantMenu(configuration);
        }

        const variant = configuration.variants[index];

        state.selectedVariant = variant;

        const groups = configuration.groups;

        if (groups.length === 0) {
          try {
            const result = await validateBotSelection({
              restaurantId,
              productId: product.id,
              variantId: variant.id,
              optionIds: [],
            });

            state.validatedSelection = result;
            state.selectedOptions = [];
            state.selectedGroupIndex = undefined;
            state.step = "SUMMARY";

            return formatSelectionSummary(
              product,
              result,
              (state.configuration?.groups.length ?? 0) > 0,
            );
          } catch (error) {
            console.error("Erro ao validar variante:", error);

            return [
              "❌ Não foi possível validar esta opção.",
              "",
              "Verifique se o produto está configurado corretamente.",
              "",
              formatVariantMenu(configuration),
            ].join("\n");
          }
        }

        state.step = "VARIANT_DETAILS";

        return formatSelectedVariant(product, variant);
      }

      case "CUSTOMER_LOOKUP":
        return "⏳ Consultando cadastro.\n\n0 - Voltar ao carrinho";
      case "CUSTOMER_NAME":
      case "CUSTOMER_NOT_FOUND":
      case "CUSTOMER_NAME_CORRECT": {
        if (!trustedWhatsAppPhone(state.whatsappPhone)) {
          state.step = "CUSTOMER_IDENTIFICATION";
          return registrationReply("unverified");
        }
        const name = normalizeCustomerName(text);
        if (!name)
          return "❌ Informe um nome válido, com 2 a 80 caracteres, sem comandos de menu.\n\nQual é o seu nome?\n\n0 - Voltar ao carrinho";
        state.draftName = name;
        state.draftPhone = state.whatsappPhone?.phone;
        state.step = "CUSTOMER_NAME_CONFIRM";
        return `✅ Nome recebido: ${name}\n\n1 - Confirmar nome\n2 - Corrigir nome\n0 - Voltar ao carrinho`;
      }
      case "CUSTOMER_NAME_CONFIRM": {
        if (choice === "2") {
          state.draftName = undefined;
          state.draftPhone = undefined;
          state.step = "CUSTOMER_NAME_CORRECT";
          return "Qual é o seu nome?\n\n0 - Voltar ao carrinho";
        }
        if (choice === "1")
          return this.confirmCustomerName(state, restaurantId);
        return "Escolha 1 para confirmar o nome ou 2 para corrigir.\n\n0 - Voltar ao carrinho";
      }
      case "CUSTOMER_REGISTERING":
        return "⏳ Concluindo cadastro inicial.\n\n0 - Voltar ao carrinho";
      case "CUSTOMER_REGISTERED":
        return this.openFulfillmentMenu(state);
      case "CUSTOMER_REGISTRATION_ERROR":
        return registrationReply(state.registrationResult ?? "error");
      case "CUSTOMER_FOUND":
        return this.openFulfillmentMenu(state);
      case "CUSTOMER_AMBIGUOUS":
      case "CUSTOMER_LOOKUP_ERROR":
        return customerIdentificationReply(state.lookupResult ?? "error");
      case "CUSTOMER_IDENTIFICATION": {
        if (whatsappPhone) return this.lookupCustomer(state, restaurantId);
        return customerIdentificationReply("unverified");
      }

      case "PICKUP_LOADING":
        return "⏳ Consultando restaurante.\n\n0 - Voltar ao carrinho";
      case "PICKUP_REVIEW":
      case "PICKUP_ERROR":
      case "FULFILLMENT_SELECTED": {
        if (
          !state.customerId ||
          !trustedWhatsAppPhone(state.whatsappPhone) ||
          state.cart.isEmpty()
        )
          return this.openFulfillmentMenu(state);
        if (
          state.step === "FULFILLMENT_SELECTED" &&
          state.pickupConfirmed &&
          state.pickupAddress
        )
          return pickupConfirmed(state.pickupAddress);
        if (choice === "1")
          return this.loadPickup(
            state,
            restaurantId,
            state.step === "PICKUP_REVIEW",
          );
        return state.pickupAddress
          ? pickupPreview(state.pickupAddress)
          : "A retirada está indisponível.\n\n1 - Consultar novamente\n0 - Voltar ao carrinho";
      }
      case "PAYMENT_SELECTION": {
        const snapshot = this.paymentSnapshot(state, restaurantId);
        if (!snapshot) return this.openFulfillmentMenu(state);
        const method = parsePaymentMethod(choice);
        if (!method) return "❌ Forma de pagamento inválida.\n\n" + PAYMENT_MENU;
        this.clearPayment(state);
        state.paymentMethod = method;
        state.paymentContext = snapshot;
        if (method === "DINHEIRO") {
          state.step = "PAYMENT_CHANGE";
          return CASH_CHANGE_MENU;
        }
        return this.reviewOrder(state);
      }
      case "PAYMENT_CHANGE":
        if (choice === "1") {
          state.step = "PAYMENT_CHANGE_AMOUNT";
          return "Para qual valor precisa de troco? Ex.: 100,00\n\n0 - Voltar ao pagamento";
        }
        if (choice === "2") return this.reviewOrder(state);
        return "❌ Opção inválida.\n\n" + CASH_CHANGE_MENU;
      case "PAYMENT_CHANGE_AMOUNT": {
        const cents = parseCashAmount(choice);
        if (cents === undefined || cents < this.orderTotal(state))
          return "❌ Informe um valor válido, igual ou maior que o total provisório, com até duas casas decimais.\n\n0 - Voltar ao pagamento";
        state.changeFor = moneyText(cents);
        return this.reviewOrder(state);
      }
      case "ORDER_REVIEW":
        if (choice === "1") {
          if (this.persistentCheckout) {
            const reply = await this.persistentCheckout.confirm(state);
            const orderId = this.persistentCheckout.completedOrderId(state);
            return orderId ? this.finishCheckout(state, orderId) : reply;
          }
          if (state.checkoutSession?.review) {
            const attempt = state.checkoutSession.beginSimulation();
            if (!attempt.started) return "Confirmação já simulada. Nenhum pedido foi criado.\n\n0 - Voltar ao pagamento";
            const completed = await attempt.completion;
            if (completed.phase !== "SUBMISSION_COMPLETED") return this.openFulfillmentMenu(state);
          }
          state.step = "ORDER_SIMULATED";
          return "✅ Confirmação simulada! Nenhum pedido foi criado e nenhum pagamento foi processado.\n\n0 - Voltar ao pagamento";
        }
        return "❌ Opção inválida.\n\n" + await this.reviewOrder(state);
      case "ORDER_SIMULATED":
        return "Confirmação já simulada. Nenhum pedido foi criado.\n\n0 - Voltar ao pagamento";

      case "FULFILLMENT_CHOICE": {
        const menu = this.openFulfillmentMenu(state);
        if (state.step !== "FULFILLMENT_CHOICE") return menu;
        if (choice !== "1" && choice !== "2")
          return "❌ Opção inválida.\n\n" + menu;
        this.clearAddress(state);
        state.fulfillmentMode = choice === "1" ? "DELIVERY" : "PICKUP";
        if (state.fulfillmentMode === "DELIVERY")
          return this.loadAddress(state, restaurantId);
        return this.loadPickup(state, restaurantId);
      }

      case "ADDRESS_LOADING":
        return "⏳ Consultando endereço.\n\n0 - Voltar ao carrinho";
      case "ADDRESS_SAVING":
        return "⏳ Salvando endereço confirmado.\n\n0 - Voltar ao carrinho";
      case "ADDRESS_EXISTING": {
        const complete = this.addressValue(state, state.addressOriginal);
        if (!complete) return this.startAddressCollection(state);
        if (choice === "1") return this.loadAddress(state, restaurantId, true);
        if (choice === "2")
          return this.loadAddress(state, restaurantId, false, true);
        if (choice.toUpperCase() === "B")
          return this.loadAddress(state, restaurantId, false, false, true);
        return "❌ Opção inválida.\n\n" + addressSummary(complete, true);
      }
      case "ADDRESS_NEIGHBORHOOD":
        return this.chooseNeighborhood(state, restaurantId);
      case "ADDRESS_STREET":
      case "ADDRESS_NUMBER":
      case "ADDRESS_CITY":
      case "ADDRESS_COMPLEMENT": {
        if (!state.addressLimits) return this.failAddress(state, "error");
        const fields: Partial<Record<Step, AddressField>> = {
          ADDRESS_STREET: "street",
          ADDRESS_NUMBER: "number",
          ADDRESS_CITY: "city",
          ADDRESS_COMPLEMENT: "complement",
        };
        const field = fields[state.step];
        if (!field) return this.failAddress(state, "error");
        const value = normalizeAddressField(
          field,
          field === "complement" && choice.toUpperCase() === "P" ? null : text,
          state.addressLimits,
        );
        if (value === undefined || (value === null && field !== "complement")) {
          return (
            "❌ Valor inválido para este campo.\n\n" +
            addressPrompt(field, state.addressLimits)
          );
        }
        state.addressDraft ??= {};
        if (field === "complement") state.addressDraft.complement = value;
        else if (typeof value === "string") state.addressDraft[field] = value;
        const inputFields: readonly AddressField[] = [
          "street",
          "number",
          "city",
          "complement",
        ];
        const next = inputFields[inputFields.indexOf(field) + 1];
        if (next) {
          const steps: Record<AddressField, Step> = {
            street: "ADDRESS_STREET",
            number: "ADDRESS_NUMBER",
            neighborhood: "ADDRESS_NEIGHBORHOOD",
            city: "ADDRESS_CITY",
            complement: "ADDRESS_COMPLEMENT",
          };
          state.step = steps[next];
          return addressPrompt(next, state.addressLimits);
        }
        const complete = this.addressValue(state, state.addressDraft, true);
        if (!complete) return this.failAddress(state, "invalid");
        state.step = "ADDRESS_REVIEW";
        return addressSummary(complete, false);
      }
      case "ADDRESS_REVIEW": {
        if (choice === "1") return this.saveAddress(state, restaurantId);
        if (choice === "2") return this.startAddressCollection(state);
        if (choice.toUpperCase() === "B")
          return this.loadAddress(state, restaurantId, false, false, true);
        const complete = this.addressValue(state, state.addressDraft, true);
        return complete
          ? "❌ Opção inválida.\n\n" + addressSummary(complete, false)
          : this.failAddress(state, "invalid");
      }
      case "ADDRESS_CONFIRMED":
        return this.refreshRegions(state, restaurantId);
      case "ADDRESS_ERROR":
        return state.addressError ?? addressErrorReply("error");

      case "DELIVERY_REGION_LOADING":
        return "⏳ Consultando regiões e taxa de entrega.\n\n0 - Voltar ao carrinho";
      case "DELIVERY_REGION_AVAILABLE": {
        if (choice.toUpperCase() === "B")
          return this.loadAddress(state, restaurantId, false, false, true);
        if (choice.toUpperCase() === "C")
          return this.loadAddress(state, restaurantId, false, true);
        if (choice.toUpperCase() === "R")
          return this.refreshRegions(state, restaurantId);
        if (choice === "1")
          return this.refreshRegions(state, restaurantId, { confirm: true });
        return state.deliveryRegion
          ? "❌ Opção inválida.\n\n" + regionPreview(state.deliveryRegion)
          : this.refreshRegions(state, restaurantId);
      }
      case "DELIVERY_REGION_CONFIRMED":
        if (choice.toUpperCase() === "B")
          return this.loadAddress(state, restaurantId, false, false, true);
        if (choice.toUpperCase() === "C")
          return this.loadAddress(state, restaurantId, false, true);
        return this.refreshRegions(state, restaurantId, { check: true });
      case "DELIVERY_REGION_NOT_FOUND":
      case "DELIVERY_REGION_GUIDANCE":
        return this.loadAddress(state, restaurantId, false, false, true);
      case "DELIVERY_REGION_AMBIGUOUS":
      case "DELIVERY_REGION_INVALID":
      case "DELIVERY_REGION_ERROR":
        if (choice.toUpperCase() === "B")
          return this.loadAddress(state, restaurantId, false, false, true);
        if (choice.toUpperCase() === "C")
          return this.loadAddress(state, restaurantId, false, true);
        if (choice.toUpperCase() === "R")
          return this.refreshRegions(state, restaurantId);
        return regionFailure(state.regionFailureKind ?? "error");

      case "DELIVERY_NEIGHBORHOOD_LOADING":
        return "⏳ Consultando os bairros atendidos.\n\n0 - Voltar ao carrinho";
      case "DELIVERY_NEIGHBORHOOD_CHOICE": {
        if (choice.toUpperCase() === "R")
          return this.chooseNeighborhood(state, restaurantId);
        const options = state.regionOptions ?? [];
        const page = state.regionPage ?? 0;
        if (
          choice.toUpperCase() === "N" &&
          (page + 1) * REGION_PAGE_SIZE < options.length
        ) {
          state.regionPage = page + 1;
          return regionChoiceList(options, page + 1);
        }
        if (choice.toUpperCase() === "A" && page > 0) {
          state.regionPage = page - 1;
          return regionChoiceList(options, page - 1);
        }
        const index = /^[1-9][0-9]*$/.test(choice) ? Number(choice) - 1 : -1;
        const selected =
          Number.isSafeInteger(index) &&
          index >= page * REGION_PAGE_SIZE &&
          index < (page + 1) * REGION_PAGE_SIZE
            ? options[index]
            : undefined;
        if (selected)
          return this.selectNeighborhood(state, restaurantId, selected);
        return (
          "❌ Escolha um bairro pelo número exibido.\n\n" +
          regionChoiceList(options, page)
        );
      }
      case "DELIVERY_NEIGHBORHOOD_ERROR":
        if (choice.toUpperCase() === "B")
          return this.chooseNeighborhood(state, restaurantId);
        if (choice.toUpperCase() === "R")
          return this.loadAddress(state, restaurantId);
        return regionFailure(state.regionFailureKind ?? "error");

      case "CART": {
        if (choice === "1") {
          const products = await getCatalogProducts(restaurantId);

          state.categories = groupProductsByCategory(products);
          state.step = "CATEGORIES";

          return formatCategories(state.categories);
        }

        if (choice === "2") {
          if (state.cart.isEmpty()) {
            return formatCart(state.cart);
          }

          state.step = "CART_REMOVE";

          const items = state.cart.list();

          return [
            "🗑️ *REMOVER PRODUTO*",
            "",
            ...items.map(
              (item, index) =>
                `${index + 1} - ${item.productName}${
                  item.variantName ? ` (${item.variantName})` : ""
                } — Qtd: ${item.quantity}`,
            ),
            "",
            "Digite o número do produto que deseja remover.",
            "0 - Voltar ao carrinho",
          ].join("\n");
        }

        if (choice === "3") {
          if (state.cart.isEmpty()) {
            return "❌ Seu carrinho está vazio.\n\n" + formatCart(state.cart);
          }

          return this.lookupCustomer(state, restaurantId);
        }

        return formatCart(state.cart);
      }

      case "DETAILS": {
        const product = state.selectedProduct;

        if (!product) {
          state.step = "PRODUCTS";

          return state.selectedCategory
            ? formatCategoryProducts(state.selectedCategory)
            : await this.initialMenu.reply(restaurantId);
        }

        if (choice !== "1") {
          return [
            `🍔 *${product.name.toUpperCase()}*`,
            "",
            `Preço: ${Number(product.price).toLocaleString("pt-BR", {
              style: "currency",
              currency: "BRL",
            })}`,
            "",
            "1 - Adicionar ao carrinho",
            "0 - Voltar aos produtos",
          ].join("\n");
        }

        if (product.has_variants) {
          return "❌ Este produto exige a seleção de uma variante.";
        }

        try {
          this.clearPayment(state);
          state.cart.add({
            productId: product.id,
            productName: product.name,
            quantity: 1,
            unitPrice: String(product.price),
          });
        } catch (error) {
          console.error("Erro ao adicionar produto:", error);

          return "❌ Não foi possível adicionar o produto ao carrinho.";
        }

        state.selectedProduct = undefined;
        state.configuration = undefined;
        state.selectedVariant = undefined;
        state.validatedSelection = undefined;
        state.selectedOptions = [];
        state.selectedGroupIndex = undefined;

        state.step = "CART";

        return [
          "✅ Produto adicionado ao carrinho!",
          "",
          formatCart(state.cart),
        ].join("\n");
      }

      case "CART_REMOVE": {
        const items = state.cart.list();

        if (!/^[1-9]\d*$/.test(choice)) {
          return (
            "❌ Digite um número válido.\n\n" +
            items
              .map((item, index) => `${index + 1} - ${item.productName}`)
              .join("\n") +
            "\n\n0 - Voltar ao carrinho"
          );
        }

        const index = Number(choice) - 1;

        this.clearPayment(state);
        const removed = state.cart.remove(index);

        if (!removed) {
          return "❌ Produto não encontrado.\n\n" + formatCart(state.cart);
        }

        state.step = "CART";

        return [
          "✅ Produto removido do carrinho!",
          "",
          formatCart(state.cart),
        ].join("\n");
      }

      // case "VARIANT_DETAILS":
      // return "Digite 0 para voltar aos tamanhos.";

      case "VARIANT_DETAILS": {
        const configuration = state.configuration;
        const variant = state.selectedVariant;

        if (!configuration || !variant) {
          state.step = "VARIANTS";
          return configuration
            ? formatVariantMenu(configuration)
            : await this.initialMenu.reply(restaurantId);
        }

        if (choice !== "1") {
          return "Digite 1 para escolher os ingredientes ou 0 para voltar.";
        }

        state.selectedGroupIndex = 0;
        state.selectedOptions = [];
        state.step = "OPTIONS";

        const group = configuration.groups[0];

        if (!group) {
          return "⚠️ Este produto não possui grupos de opções configurados.";
        }

        return formatGroupOptions(group, variant);
      }
    }
  }
}
