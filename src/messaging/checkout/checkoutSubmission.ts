import type { RestaurantContext } from "../contracts";
import { assertSameContext, MessagingValidationError } from "../validation";
import { WhatsAppCheckoutAuthorizer, CheckoutAuthorizationError, CheckoutCommitUncertainError, type WhatsAppCheckoutAuthorization } from "./checkoutAuthorization";
import { validateCheckoutIntentRequest, createCheckoutIntentRequest, lockCheckoutIntent, completeCheckoutIntent, markCheckoutIntentRecoverable, CheckoutIntentConflict, type CheckoutIntentRequest } from "./checkoutIdempotency";
import { revalidateCheckoutReview, type CheckoutReviewSnapshot, type CheckoutRevalidationResult } from "./checkoutRevalidation";
import { persistValidatedOrder } from "../../service/order/persistValidatedOrder";
import { GetOrderItemService, type FullOrder } from "../../service/order_item/GetOrderItemService";
import { OrderValidationError } from "../../service/order/orderValidation";

export type CheckoutSubmissionResult =
  | { readonly kind: "success"; readonly intentId: string; readonly replayed: boolean; readonly fullOrder: FullOrder }
  | ({ readonly intentId: string } & Extract<CheckoutRevalidationResult, { kind: "review_required" }>)
  | { readonly kind: "recoverable_failure"; readonly intentId: string; readonly reason: "SERIALIZATION_CONFLICT" | "COMMIT_UNKNOWN" | "TRANSACTION_ABORTED"; readonly reuseSameKey: true }
  | { readonly kind: "rejected"; readonly intentId: string; readonly reason: "UNAUTHORIZED" | "INTENT_CONFLICT" | "INVALID_CHECKOUT" | "NOT_CONFIGURED" | "PERSISTENCE_REJECTED" };

export interface CheckoutSubmission {
  readonly context: RestaurantContext;
  readonly authorization: WhatsAppCheckoutAuthorization;
  /** May be absent after restart: completed intents replay, pending intents require new review. */
  readonly snapshot: CheckoutReviewSnapshot | null;
  readonly intent: CheckoutIntentRequest;
}

/** Internal service only. Not connected to any WhatsApp/HTTP handler; no external notifications. */
export class WhatsAppCheckoutSubmission {
  constructor(private readonly authorizer: WhatsAppCheckoutAuthorizer) {}

  async submit({ context, authorization, snapshot, intent }: CheckoutSubmission): Promise<CheckoutSubmissionResult> {
    const trustedContext = { ...context };
    const intentId = intent.intentId;
    try {
      const expected = validateCheckoutIntentRequest(intent);
      return await this.authorizer.withAuthorizedTransaction(authorization, async (client, checkout, session) => {
        assertSameContext(trustedContext, session.context);
        // Rebuild from the authorized live session, not from caller-supplied ownership or prices.
        const request = createCheckoutIntentRequest(session, expected.intentId);
        if (request.checkoutHash !== expected.checkoutHash || request.canonicalCheckout !== expected.canonicalCheckout) throw new CheckoutIntentConflict();
        const locked = await lockCheckoutIntent(client, request);
        if (locked.state === "COMPLETED") {
          const fullOrder = await new GetOrderItemService().findByOrderId(locked.order_id, client);
          if (!fullOrder || fullOrder.restaurant_id !== checkout.restaurant_id || fullOrder.customer.id !== checkout.customer_id || fullOrder.order_id !== locked.order_id) throw new CheckoutIntentConflict();
          return { kind: "success", intentId: expected.intentId, replayed: true, fullOrder };
        }
        const review: CheckoutRevalidationResult = snapshot
          ? await revalidateCheckoutReview(client, trustedContext, checkout, snapshot)
          : { kind: "review_required", changes: ["CHECKOUT"] };
        if (review.kind === "review_required") {
          await markCheckoutIntentRecoverable(client, request, "REVALIDATION_REQUIRED");
          return { ...review, intentId: expected.intentId };
        }
        const saved = await persistValidatedOrder(client, review.validated);
        await completeCheckoutIntent(client, request, saved.order.id);
        return { kind: "success", intentId: expected.intentId, replayed: false, fullOrder: saved.fullOrder };
      });
    } catch (error) {
      if (error instanceof CheckoutCommitUncertainError) return { kind: "recoverable_failure", intentId, reason: "COMMIT_UNKNOWN", reuseSameKey: true };
      if (error instanceof CheckoutAuthorizationError) return { kind: "rejected", intentId, reason: "UNAUTHORIZED" };
      if (error instanceof CheckoutIntentConflict) return { kind: "rejected", intentId, reason: "INTENT_CONFLICT" };
      if (error instanceof MessagingValidationError || error instanceof OrderValidationError) return { kind: "rejected", intentId, reason: "INVALID_CHECKOUT" };
      const code = (error as { code?: string })?.code;
      if (code === "40001" || code === "40P01") return { kind: "recoverable_failure", intentId, reason: "SERIALIZATION_CONFLICT", reuseSameKey: true };
      if (code === "42P01" || code === "42703" || code === "42501") return { kind: "rejected", intentId, reason: "NOT_CONFIGURED" };
      if (code?.startsWith("23")) return { kind: "rejected", intentId, reason: "PERSISTENCE_REJECTED" };
      return { kind: "recoverable_failure", intentId, reason: "TRANSACTION_ABORTED", reuseSameKey: true };
    }
  }
}
