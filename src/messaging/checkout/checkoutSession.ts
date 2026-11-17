import type { WhatsAppCheckoutAuthorization, WhatsAppCheckoutSession } from "./checkoutAuthorization";
import type { CheckoutSubmission } from "./checkoutSubmission";
import { captureCheckoutReview, type CheckoutReviewSnapshot } from "./checkoutRevalidation";
import { createCheckoutIntentRequest, newCheckoutIntentId, type CheckoutIntentRequest } from "./checkoutIdempotency";
export class CheckoutSessionInvalidError extends Error {
  constructor() { super("A revisão da sessão está ausente ou foi invalidada."); }
}

export type SessionSubmissionState =
  | { readonly phase: "IDLE" }
  | { readonly phase: "REVIEW_READY"; readonly intentId: string }
  | { readonly phase: "SUBMISSION_PENDING"; readonly intentId: string; readonly mode: "simulation" }
  | { readonly phase: "SUBMISSION_COMPLETED"; readonly intentId: string; readonly mode: "simulation" }
  | { readonly phase: "SUBMISSION_RECOVERABLE_FAILURE"; readonly intentId: string; readonly reason: "SIMULATION_FAILED" | "STATE_CHANGED" };

export interface PreparedSessionCheckout {
  readonly registration: "LOCAL_ONLY" | "REGISTERING" | "DURABLE" | "COMMIT_UNKNOWN" | "REGISTRATION_FAILED";
  readonly snapshot: CheckoutReviewSnapshot;
  readonly intent: CheckoutIntentRequest;
  readonly identityRevision: number;
  readonly binding: string;
}

/** Session-local coordination only. Durable deduplication remains H.4, not this lock. */
export class LiveCheckoutSession {
  private prepared?: PreparedSessionCheckout;
  private valid = false;
  private durable?: Readonly<{ intent: CheckoutIntentRequest; registration: "REGISTERING" | "DURABLE" | "COMMIT_UNKNOWN" | "REGISTRATION_FAILED"; state?: "PENDING" | "COMPLETED" | "RECOVERABLE_FAILURE" }>;
  private state: SessionSubmissionState = Object.freeze({ phase: "IDLE" });
  private inFlight?: Promise<SessionSubmissionState>;

  constructor(
    private readonly current: () => WhatsAppCheckoutSession,
    // A simulation-only scheduling seam. It returns no order, and has no production implementation switch.
    private readonly finishSimulation: () => Promise<void> = () => Promise.resolve(),
  ) {}

  get recoveryReference() { return this.durable; }
  get status(): SessionSubmissionState { return this.state; }
  get review(): PreparedSessionCheckout | undefined { this.refresh(); return this.valid ? this.prepared : undefined; }

  private sessionForComparison(): WhatsAppCheckoutSession {
    const session = this.current();
    if (!["ORDER_REVIEW", "ORDER_SIMULATED"].includes(session.checkout.step)) throw new CheckoutSessionInvalidError();
    if (!Number.isSafeInteger(session.identityRevision) || session.identityRevision < 0) throw new CheckoutSessionInvalidError();
    return { ...session, checkout: { ...session.checkout, step: "ORDER_REVIEW" } };
  }

  private fingerprint(session: WhatsAppCheckoutSession, intent: CheckoutIntentRequest): string {
    return JSON.stringify([intent.canonicalCheckout, session.identityRevision, session.transportIdentity]);
  }

  /** Captures once at presentation; invalid menu input/reconnection cannot replace a valid review. */
  presentReview(): PreparedSessionCheckout {
    const session = this.current();
    if (session.checkout.step !== "ORDER_REVIEW" || !Number.isSafeInteger(session.identityRevision) || session.identityRevision < 0) throw new CheckoutSessionInvalidError();
    if (this.durable && !this.valid) throw new CheckoutSessionInvalidError();
    const candidate = createCheckoutIntentRequest(session, this.prepared?.intent.intentId ?? newCheckoutIntentId());
    const binding = this.fingerprint(session, candidate);
    if (this.durable && this.prepared?.binding !== binding) { this.invalidate(); throw new CheckoutSessionInvalidError(); }
    if (this.valid && this.prepared?.binding === binding) return this.prepared;
    if (this.state.phase === "SUBMISSION_PENDING") {
      this.invalidate();
      throw new CheckoutSessionInvalidError();
    }
    const intent = this.prepared ? createCheckoutIntentRequest(session, newCheckoutIntentId()) : candidate;
    this.prepared = Object.freeze({
      registration: "LOCAL_ONLY", snapshot: captureCheckoutReview(session.context, session.checkout),
      intent, identityRevision: session.identityRevision, binding: this.fingerprint(session, intent),
    });
    this.valid = true;
    this.state = Object.freeze({ phase: "REVIEW_READY", intentId: intent.intentId });
    return this.prepared;
  }

  /** A pending attempt retains its original key for reconciliation, even if its session changes. */
  invalidate(): void {
    this.valid = false;
    if (this.state.phase !== "SUBMISSION_PENDING" && !this.durable) {
      this.prepared = undefined;
      this.state = Object.freeze({ phase: "IDLE" });
    }
  }

  refresh(): void {
    if (!this.valid || !this.prepared) return;
    try {
      const session = this.sessionForComparison();
      const current = createCheckoutIntentRequest(session, this.prepared.intent.intentId);
      if (this.fingerprint(session, current) !== this.prepared.binding) this.invalidate();
    } catch { this.invalidate(); }
  }

  /** The future H.2 authorizer must call this getter, never a captured session copy. */
  readCurrentSession = (): WhatsAppCheckoutSession => {
    this.refresh();
    if (!this.valid || !this.prepared) throw new CheckoutSessionInvalidError();
    return this.current();
  };

  /** Builds only H.5A's DTO. Does NOT authorize, register an intent, or invoke submission. */
  createSubmission(authorization: WhatsAppCheckoutAuthorization): CheckoutSubmission {
    this.readCurrentSession();
    const prepared = this.prepared!;
    return Object.freeze({ context: prepared.intent.scope.context, authorization, snapshot: prepared.snapshot, intent: prepared.intent });
  }

  /** Explicit infrastructure hook only; never called by the simulated menu. */
  beginDurableRegistration(): PreparedSessionCheckout {
    this.readCurrentSession();
    if (this.inFlight || this.durable?.registration === "REGISTERING") throw new CheckoutSessionInvalidError();
    const prepared = this.prepared!;
    this.durable = Object.freeze({ intent: prepared.intent, registration: "REGISTERING" });
    this.prepared = Object.freeze({ ...prepared, registration: "REGISTERING" });
    return prepared;
  }

  finishDurableRegistration(intent: CheckoutIntentRequest, state: "PENDING" | "COMPLETED" | "RECOVERABLE_FAILURE"): boolean {
    if (this.durable?.intent.intentId !== intent.intentId || this.durable.intent.checkoutHash !== intent.checkoutHash) throw new CheckoutSessionInvalidError();
    this.durable = Object.freeze({ intent, registration: "DURABLE", state });
    this.refresh();
    if (!this.valid || !this.prepared) return false;
    this.prepared = Object.freeze({ ...this.prepared, registration: "DURABLE" });
    return true;
  }

  registrationFailed(intent: CheckoutIntentRequest, uncertain: boolean): void {
    if (this.durable?.intent.intentId !== intent.intentId) return;
    if (uncertain) {
      this.durable = Object.freeze({ intent, registration: "COMMIT_UNKNOWN" });
      if (this.prepared) this.prepared = Object.freeze({ ...this.prepared, registration: "COMMIT_UNKNOWN" });
    } else {
      // Our rollback does not prove that another worker never registered this same key.
      this.durable = Object.freeze({ intent, registration: "REGISTRATION_FAILED" });
      if (this.prepared) this.prepared = Object.freeze({ ...this.prepared, registration: "REGISTRATION_FAILED" });
    }
  }

  /** Must be called at a NEW presentation, after authenticated recovery of the exact key. */
  presentRecoveredReview(intent: CheckoutIntentRequest, state: "PENDING" | "RECOVERABLE_FAILURE"): PreparedSessionCheckout {
    if (this.inFlight || this.durable?.registration === "REGISTERING") throw new CheckoutSessionInvalidError();
    const session = this.current();
    const current = createCheckoutIntentRequest(session, intent.intentId);
    if (current.checkoutHash !== intent.checkoutHash || current.canonicalCheckout !== intent.canonicalCheckout) throw new CheckoutSessionInvalidError();
    this.prepared = Object.freeze({ registration: "DURABLE", intent, snapshot: captureCheckoutReview(session.context, session.checkout),
      identityRevision: session.identityRevision, binding: this.fingerprint(session, intent) });
    this.durable = Object.freeze({ intent, registration: "DURABLE", state });
    this.valid = true;
    this.state = Object.freeze({ phase: "REVIEW_READY", intentId: intent.intentId });
    return this.prepared;
  }

  /** Future activation must use this guarded DTO with H.5A, after registration and fresh H.2 authorization. */
  createRegisteredSubmission(authorization: WhatsAppCheckoutAuthorization): CheckoutSubmission {
    this.readCurrentSession();
    if (this.durable?.registration !== "DURABLE" || this.durable.state === "COMPLETED" || this.prepared?.registration !== "DURABLE") throw new CheckoutSessionInvalidError();
    return this.createSubmission(authorization);
  }

  beginSimulation(): { readonly started: boolean; readonly completion: Promise<SessionSubmissionState> } {
    this.refresh();
    if (this.inFlight) return { started: false, completion: this.inFlight };
    if (!this.valid || !this.prepared) throw new CheckoutSessionInvalidError();
    if (this.state.phase === "SUBMISSION_COMPLETED") return { started: false, completion: Promise.resolve(this.state) };
    const intentId = this.prepared.intent.intentId;
    this.state = Object.freeze({ phase: "SUBMISSION_PENDING", intentId, mode: "simulation" });
    this.inFlight = Promise.resolve().then(this.finishSimulation).then(() => {
      this.refresh();
      this.state = Object.freeze(this.valid
        ? { phase: "SUBMISSION_COMPLETED", intentId, mode: "simulation" }
        : { phase: "SUBMISSION_RECOVERABLE_FAILURE", intentId, reason: "STATE_CHANGED" });
      return this.state;
    }, () => {
      this.refresh();
      this.state = Object.freeze({ phase: "SUBMISSION_RECOVERABLE_FAILURE", intentId, reason: this.valid ? "SIMULATION_FAILED" : "STATE_CHANGED" });
      return this.state;
    }).finally(() => { this.inFlight = undefined; });
    return { started: true, completion: this.inFlight };
  }
}
