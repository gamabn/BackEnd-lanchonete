import type { PoolClient } from "pg";
import { pool } from "../../database";
import { GetClientService } from "../../service/clients/GetClientService";
import { identifyCustomer, createCustomerReader, type CustomerReader } from "../core/customerIdentification";
import { phoneFromJid, trustedWhatsAppPhone, type WhatsAppPhoneIdentity } from "../channels/whatsapp/phoneIdentity";
import type { RestaurantContext, ExternalIdentity } from "../contracts";
import type { CheckoutState } from "../core/checkoutSnapshot";
import { validateExternalIdentity, validateRestaurantContext } from "../validation";
import { adaptWhatsAppCheckout, type AdaptedCheckout } from "./checkoutAdapter";

/** Supplied by the trusted session store and transport, never by message content. */
export interface WhatsAppSessionIdentity {
  readonly context: RestaurantContext;
  readonly sender: ExternalIdentity;
  readonly transportIdentity?: WhatsAppPhoneIdentity;
  /** Monotonic within the logical session; bootstrap must reconcile the durable baseline. */
  readonly identityRevision: number;
}
export interface WhatsAppCheckoutSession extends WhatsAppSessionIdentity {
  readonly checkout: CheckoutState;
}

/** Shared transport boundary for checkout authorization and durable recovery. No text fields. */
export function readWhatsAppSessionIdentity(current: () => WhatsAppSessionIdentity): WhatsAppSessionIdentity {
  try {
    const session = current();
    validateRestaurantContext(session.context);
    validateExternalIdentity(session.sender);
    const phone = trustedWhatsAppPhone(session.transportIdentity);
    if (!phone || session.context.channel !== "whatsapp" || session.sender.channel !== "whatsapp" ||
        !Number.isSafeInteger(session.identityRevision) || session.identityRevision < 0 ||
        !/^[^\s@]+@(s\.whatsapp\.net|lid)$/.test(session.sender.subject_id) ||
        (session.sender.subject_id.endsWith("@s.whatsapp.net") && phoneFromJid(session.sender.subject_id) !== phone)) throw new CheckoutAuthorizationError();
    return Object.freeze({ context: Object.freeze({ ...session.context }), sender: Object.freeze({ ...session.sender }),
      transportIdentity: Object.freeze({ ...session.transportIdentity! }), identityRevision: session.identityRevision });
  } catch { throw new CheckoutAuthorizationError(); }
}

const authorizationBrand: unique symbol = Symbol("WhatsAppCheckoutAuthorization");
/** Process-local capability, not an HTTP credential or a serializable authorization proof. */
export interface WhatsAppCheckoutAuthorization {
  readonly [authorizationBrand]: true;
}

export class CheckoutAuthorizationError extends Error {
  constructor() {
    super("Não foi possível autorizar o checkout. Identifique-se e revise os dados novamente.");
  }
}

/** A commit transport error is not proof of rollback. Reconcile the original intent. */
export class CheckoutCommitUncertainError extends Error {
  constructor(readonly originalError: unknown) { super("Resultado do commit incerto; reconcilie a mesma intenção."); }
}

interface Binding {
  readonly fingerprint: string;
  readonly phone: NonNullable<CheckoutState["whatsappPhone"]>;
  readonly checkout: AdaptedCheckout;
}
interface Grant {
  readonly binding: Binding;
  readonly current: () => WhatsAppCheckoutSession;
}

type TransactionClient = Pick<PoolClient, "query" | "release">;
type AuthorizationDatabase = { connect(): Promise<TransactionClient> };

/**
 * Internal authorization only. No order submission, HTTP authentication or socket effects.
 * The live getter must read the owning session; do not pass a frozen copy of that session.
 */
export class WhatsAppCheckoutAuthorizer {
  private readonly grants = new WeakMap<WhatsAppCheckoutAuthorization, Grant>();
  private readonly inFlight = new WeakSet<WhatsAppCheckoutAuthorization>();

  constructor(
    private readonly reader: CustomerReader = createCustomerReader(),
    private readonly database: AuthorizationDatabase = pool,
  ) {}

  private bind(current: () => WhatsAppCheckoutSession): Binding {
    try {
      const session = current();
      const { context, sender, identityRevision, transportIdentity } = readWhatsAppSessionIdentity(() => session);
      const { checkout } = session;
      if (trustedWhatsAppPhone(transportIdentity) !== trustedWhatsAppPhone(checkout.whatsappPhone)) throw new CheckoutAuthorizationError();
      const adapted = adaptWhatsAppCheckout(context, checkout);
      return {
        fingerprint: JSON.stringify([
          context.restaurant_id, context.session_id, context.channel,
          sender.channel, sender.account_id, sender.subject_id, identityRevision,
          transportIdentity, checkout.whatsappPhone, checkout.paymentContext, adapted,
        ]),
        phone: { ...transportIdentity! },
        checkout: adapted,
      };
    } catch {
      throw new CheckoutAuthorizationError();
    }
  }

  private async identify(binding: Binding, reader: CustomerReader): Promise<void> {
    const found = await identifyCustomer(binding.checkout.restaurant_id, binding.phone, reader);
    if (found.kind !== "found" || found.customerId !== binding.checkout.customer_id) {
      throw new CheckoutAuthorizationError();
    }
  }

  private assertCurrent(token: WhatsAppCheckoutAuthorization, grant: Grant): Binding {
    try {
      if (this.grants.get(token) !== grant) throw new CheckoutAuthorizationError();
      const binding = this.bind(grant.current);
      if (binding.fingerprint !== grant.binding.fingerprint) throw new CheckoutAuthorizationError();
      return binding;
    } catch {
      this.invalidate(token);
      throw new CheckoutAuthorizationError();
    }
  }

  async authorize(current: () => WhatsAppCheckoutSession): Promise<WhatsAppCheckoutAuthorization> {
    const binding = this.bind(current);
    await this.identify(binding, this.reader);
    // Reject late reads after a session, identity or checkout change.
    if (this.bind(current).fingerprint !== binding.fingerprint) throw new CheckoutAuthorizationError();
    const token: WhatsAppCheckoutAuthorization = Object.freeze({ [authorizationBrand]: true as const });
    this.grants.set(token, { binding, current });
    return token;
  }

  invalidate(token: WhatsAppCheckoutAuthorization): void {
    this.grants.delete(token);
  }

  /**
   * Future persistence MUST run inside this callback using this exact client.
   * SERIALIZABLE also protects the ambiguity check against concurrent phantoms;
   * FOR SHARE keeps matched customer ownership/phone stable until commit.
   * No transaction, result or authorization may be reused after this scope.
   */
  async withAuthorizedTransaction<T>(
    token: WhatsAppCheckoutAuthorization,
    action: (client: Pick<PoolClient, "query">, checkout: AdaptedCheckout, session: WhatsAppCheckoutSession) => Promise<T>,
  ): Promise<T> {
    const grant = this.grants.get(token);
    if (!grant || this.inFlight.has(token)) throw new CheckoutAuthorizationError();
    this.assertCurrent(token, grant);
    this.inFlight.add(token);
    let client: TransactionClient | undefined;
    let begun = false;
    let discardConnection = false;
    try {
      client = await this.database.connect();
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      begun = true;
      const before = this.assertCurrent(token, grant);
      const customerService = new GetClientService(client);
      let lookupError: unknown;
      try {
        await this.identify(before, {
          findByWhatsAppPhone: async args => {
            try { return await customerService.findByWhatsAppPhone(args, "share"); }
            catch (error) { lookupError = error; throw error; }
          },
        });
      } catch (error) {
        // identifyCustomer intentionally hides SQL errors; the transaction owner
        // must still distinguish serialization/connection failures from denial.
        throw lookupError ?? error;
      }
      const authorized = this.assertCurrent(token, grant);
      const result = await action(client, authorized.checkout, grant.current());
      this.assertCurrent(token, grant);
      try {
        await client.query("COMMIT");
      } catch (error) {
        discardConnection = true;
        const code = (error as { code?: string })?.code;
        if (code === "40001" || code === "40P01") throw error;
        throw new CheckoutCommitUncertainError(error);
      }
      begun = false;
      return result;
    } finally {
      // A grant is single-use even on rollback; retries require fresh authorization.
      this.invalidate(token);
      try {
        if (begun && client) {
          await client.query("ROLLBACK").catch(() => { discardConnection = true; });
        }
      } finally {
        this.inFlight.delete(token);
        client?.release(discardConnection);
      }
    }
  }
}
