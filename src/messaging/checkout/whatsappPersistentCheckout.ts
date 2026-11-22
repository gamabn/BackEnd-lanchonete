import { GetClientService } from "../../service/clients/GetClientService";
import type { Server } from "socket.io";
import type { Pool } from "pg";
import {
  WhatsAppCheckoutAuthorizer,
  type WhatsAppCheckoutSession,
} from "./checkoutAuthorization";
import { ActiveCheckoutSessions } from "./activeCheckoutSession";
import { LiveCheckoutSession } from "./checkoutSession";
import {
  WhatsAppCheckoutSubmission,
  type CheckoutSubmissionResult,
} from "./checkoutSubmission";
import { restaurantRoom } from "../../socket/orders";
import { EnviarWebPushService } from "../../service/webPushService/enviarWebPushService";

type Current = () => WhatsAppCheckoutSession;
type Entry = {
  binding?: string;
  ready: boolean;
  coordinator?: LiveCheckoutSession;
  completed?: string;
  uncertain?: boolean;
};
import { CHECKOUT_UNAVAILABLE, checkoutSuccess } from "./checkoutReplies";

/** Explicitly injected into the worker; constructing the default menu never enables writes. */
export class PersistentWhatsAppCheckout {
  private readonly sessions = new WeakMap<object, Entry>();
  constructor(
    private readonly authorizer: WhatsAppCheckoutAuthorizer,
    private readonly active: ActiveCheckoutSessions,
    private readonly submission: Pick<WhatsAppCheckoutSubmission, "submit">,
    private readonly notify: (
      result: Extract<CheckoutSubmissionResult, { kind: "success" }>,
    ) => void | Promise<void>,
  ) {}
  private entry(owner: object): Entry {
    let entry = this.sessions.get(owner);
    if (!entry) {
      entry = { ready: false };
      this.sessions.set(owner, entry);
    }
    return entry;
  }
  /** Read-only completion signal for conversation navigation; never reauthorizes submission. */
  completedOrderId(owner: object): string | undefined {
    return this.sessions.get(owner)?.completed;
  }
  /** Before interpreting the first message, recover durable scope, never its old confirmation. */
  async resume(
    owner: object,
    current: Current,
    installRevision: (n: number) => void,
  ) {
    const entry = this.entry(owner);
    const identity = current();
    const binding = JSON.stringify([
      identity.context,
      identity.sender,
      identity.transportIdentity,
    ]);
    if (entry.binding && entry.binding !== binding)
      return { kind: "unavailable" as const };
    entry.binding = binding;
    if (entry.completed)
      return { kind: "completed" as const, orderId: entry.completed };
    if (entry.ready && !entry.uncertain) return { kind: "ready" as const };
    try {
      const initial = current();
      const bootstrap = () => ({ ...current(), identityRevision: null });
      const inspection = await this.active.inspectBootstrap(bootstrap);
      if (inspection.kind === "reconciliation_required") {
        const reconciled = await this.active.reconcileBootstrap(
          inspection.challenge,
          bootstrap,
        );
        if (reconciled.kind !== "generation_reconciled")
          return { kind: "unavailable" as const };
        // Only initial bootstrap may adopt the persisted generation.
        if (
          entry.uncertain &&
          reconciled.identityRevision !== initial.identityRevision
        )
          return { kind: "unavailable" as const };
        installRevision(reconciled.identityRevision);
      } else if (inspection.kind !== "no_durable_generation")
        return { kind: "unavailable" as const };
      const recovered = await this.active.recoverActive(current);
      if (recovered.kind === "completed") {
        entry.completed = recovered.orderId;
        return { kind: "completed" as const, orderId: recovered.orderId };
      }
      if (recovered.kind === "review_required" && recovered.session) {
        entry.ready = true;
        entry.uncertain = false;
        entry.coordinator = undefined;
        return {
          kind: "review" as const,
          checkout: recovered.session.checkout,
        };
      }
      if (recovered.kind !== "no_active_intent")
        return { kind: "unavailable" as const };
      entry.ready = true;
      entry.uncertain = false;
      return { kind: "ready" as const };
    } catch {
      return { kind: "unavailable" as const };
    }
  }
  async prepare(owner: object, current: Current): Promise<boolean> {
    const entry = this.entry(owner);
    if (!entry.ready || entry.uncertain || entry.completed) return false;
    try {
      const recovered = await this.active.recoverActive(current);
      if (recovered.kind === "completed") {
        entry.completed = recovered.orderId;
        return false;
      }
      const coordinator = new LiveCheckoutSession(current);
      const prepared = coordinator.presentReview();
      if (recovered.kind === "review_required" && recovered.session) {
        if (recovered.intent.checkoutHash === prepared.intent.checkoutHash) {
          coordinator.presentRecoveredReview(recovered.intent, recovered.state);
        } else {
          const auth = await this.authorizer.authorize(current);
          const result = await this.active.replaceActive(coordinator, auth, {
            intentId: recovered.intent.intentId,
            identityRevision: recovered.storedIdentityRevision!,
          });
          if (result.kind !== "registered" || !result.current) {
            entry.uncertain = true;
            return false;
          }
        }
      } else if (recovered.kind === "no_active_intent") {
        const auth = await this.authorizer.authorize(current);
        const result = await this.active.registerActive(coordinator, auth);
        if (result.kind !== "registered" || !result.current) {
          entry.uncertain = true;
          return false;
        }
      } else return false;
      entry.coordinator = coordinator;
      return true;
    } catch {
      entry.coordinator = undefined;
      entry.uncertain = true;
      return false;
    }
  }
  async confirm(owner: object): Promise<string> {
    const entry = this.entry(owner);
    if (entry.completed) return checkoutSuccess(entry.completed);
    const coordinator = entry.coordinator;
    if (!coordinator || entry.uncertain) return CHECKOUT_UNAVAILABLE;
    try {
      const authorization = await this.authorizer.authorize(
        coordinator.readCurrentSession,
      );
      const result = await this.submission.submit(
        coordinator.createRegisteredSubmission(authorization),
      );
      if (result.kind === "success") {
        entry.completed = result.fullOrder.order_id;
        // Submission returns only after COMMIT; replay and recovery never notify.
        if (!result.replayed) {
          try {
            await this.notify(result);
          } catch {
            /* confirmed order remains successful */
          }
        }
        return checkoutSuccess(entry.completed);
      }
      if (result.kind === "review_required") {
        entry.coordinator = undefined;
        return "Os dados do pedido mudaram. Volte ao pagamento, atualize o carrinho ou endereço e revise novamente antes de confirmar.\n\n0 - Voltar ao pagamento";
      }
      entry.uncertain = true;
      return CHECKOUT_UNAVAILABLE;
    } catch {
      entry.uncertain = true;
      return CHECKOUT_UNAVAILABLE;
    }
  }
}

/** Host must explicitly provide its configured Socket.IO server and database pool. */
export function createPersistentWhatsAppCheckout(
  database: Pool,
  io: Server,
): PersistentWhatsAppCheckout {
  const authorizer = new WhatsAppCheckoutAuthorizer(
    new GetClientService(database),
    database,
  );
  const active = new ActiveCheckoutSessions(authorizer, database);
  return new PersistentWhatsAppCheckout(
    authorizer,
    active,
    new WhatsAppCheckoutSubmission(authorizer),
    async (result) => {
      // Mantém a notificação em tempo real pelo Socket.IO.
      io.of("/orders")
        .to(restaurantRoom(result.fullOrder.restaurant_id))
        .emit("newOrder", result.fullOrder);

      // Envia Web Push para os dispositivos inscritos.
      try {
        const webPushService = new EnviarWebPushService();

        const valorFormatado = new Intl.NumberFormat("pt-BR", {
          style: "currency",
          currency: "BRL",
        }).format(result.fullOrder.total_price);

        const delivery = await webPushService.handle({
          lanchonete_id: result.fullOrder.restaurant_id,
          titulo: "Novo pedido recebido!",
          mensagem: `${result.fullOrder.customer.name} fez um pedido. Total: ${valorFormatado}`,
          url: "/dashboard",
        });

        console.log("✅ Resultado Web Push WhatsApp:", delivery);
      } catch (error) {
        console.error("❌ Erro ao enviar Web Push do WhatsApp:", error);
      }
    },
    //==============================================
    // (result) => {
    // io.of("/orders")
    //   .to(restaurantRoom(result.fullOrder.restaurant_id))
    //   .emit("newOrder", result.fullOrder);
    // },
    //=======================================================================
  );
}
