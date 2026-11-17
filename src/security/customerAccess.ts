import { createHmac } from "crypto";
import { sign, verify } from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

export type CustomerPrincipal =
  | { type: "customer"; customerId: string; restaurantId: string }
  | { type: "restaurant"; restaurantId: string };
export interface CustomerData {
  name: string;
  phone: string;
  city: string | null;
  street?: string | null;
  number?: string | null;
  neighborhood?: string | null;
  complement?: string | null;
}
export interface CustomerRecord extends CustomerData { id: string; restaurant_id: string }
export const customerColumns = "id, name, phone, city, street, number, neighborhood, complement, restaurant_id";
export const customerCredentialLifetime = 60 * 60 * 24 * 30;
function customerKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET não configurado");
  return createHmac("sha256", secret).update("gama:customer-profile:v1").digest();
}
export function issueCustomerCredential(customer: Pick<CustomerRecord, "id" | "restaurant_id">) {
  return sign({ restaurantId: customer.restaurant_id }, customerKey(), {
    subject: customer.id, algorithm: "HS256", issuer: "gama-delivery",
    audience: "customer-profile", expiresIn: customerCredentialLifetime,
  });
}
export function authenticateCustomerAccess(token: string): CustomerPrincipal {
  try {
    const payload = verify(token, customerKey(), {
      algorithms: ["HS256"], issuer: "gama-delivery", audience: "customer-profile",
    });
    if (typeof payload !== "string" && typeof payload.sub === "string" && payload.sub &&
        typeof payload.restaurantId === "string" && payload.restaurantId && typeof payload.exp === "number") {
      return { type: "customer", customerId: payload.sub, restaurantId: payload.restaurantId };
    }
  } catch (error) {
    if ((error as { name?: string })?.name === "TokenExpiredError") throw error;
    // A distinct key prevents chat/socket credentials from granting profile access.
  }
  const payload = verify(token, process.env.JWT_SECRET as string, { algorithms: ["HS256"] });
  if (typeof payload === "string" || typeof payload.sub !== "string" || !payload.sub || payload.aud) throw new Error("Não autorizado");
  return { type: "restaurant", restaurantId: payload.sub };
}
export function customerAccess(req: Request, res: Response, next: NextFunction) {
  res.set("Cache-Control", "no-store");
  let actor: CustomerPrincipal;
  try {
    const match = req.headers.authorization?.match(/^Bearer (\S+)$/);
    if (!match) throw new Error("Credencial ausente");
    actor = authenticateCustomerAccess(match[1]);
  } catch (error) {
    const expired = (error as { name?: string })?.name === "TokenExpiredError";
    return res.status(401).json({
      error: expired ? "A sessão do cliente expirou." : "Credencial de cliente inválida.",
      code: expired ? "SESSION_EXPIRED" : "SESSION_INVALID",
    });
  }
  const requestedRestaurant = req.params.id || req.headers["x-customer-restaurant"];
  if (requestedRestaurant !== undefined && requestedRestaurant !== actor.restaurantId) {
    return res.status(403).json({ error: "Cadastro não autorizado.", code: "CUSTOMER_FORBIDDEN" });
  }
  res.locals.customerPrincipal = actor;
  return next();
}
// Only the creation controller opts into the explicit PICKUP signup contract.
// Updates retain their original allowlist and required city; a request-body mode
// can never relax update validation or change ownership.
export function readCustomerData(input: unknown, purpose: "update" | "create" = "update"): CustomerData | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const data = input as Record<string, unknown>;
  const address = ["city", "street", "number", "neighborhood", "complement"] as const;
  const writable = ["name", "phone", ...address, ...(purpose === "create" ? ["fulfillment_type"] : [])];
  if (Object.keys(data).some(key => !writable.includes(key))) return undefined;
  if (typeof data.name !== "string" || !data.name.trim() ||
      typeof data.phone !== "string" || !data.phone.trim()) return undefined;

  if (purpose === "create") {
    const mode = data.fulfillment_type === undefined ? "DELIVERY" : data.fulfillment_type;
    if (mode !== "DELIVERY" && mode !== "PICKUP") return undefined;
    if (mode === "PICKUP") {
      // Contact-only signup. Reject supplied address data rather than silently
      // persisting a restaurant address or an accidentally stale delivery form.
      if (address.some(key => data[key] !== undefined && data[key] !== null &&
          (typeof data[key] !== "string" || (data[key] as string).trim() !== ""))) return undefined;
      return { name: data.name.trim(), phone: data.phone.trim(),
        city: null, street: null, number: null, neighborhood: null, complement: null };
    }
    if (["city", "street", "number", "neighborhood"].some(key =>
        typeof data[key] !== "string" || !(data[key] as string).trim())) return undefined;
    if (data.complement !== undefined && data.complement !== null && typeof data.complement !== "string") return undefined;
  } else {
    if (typeof data.city !== "string" || !data.city.trim()) return undefined;
    for (const key of ["street", "number", "neighborhood", "complement"]) {
      if (data[key] !== undefined && typeof data[key] !== "string") return undefined;
    }
  }
  const optional = (value: unknown) => typeof value === "string" ? value.trim() || null : null;
  return {
    name: data.name.trim(), phone: data.phone.trim(), city: (data.city as string).trim(),
    street: optional(data.street), number: optional(data.number),
    neighborhood: optional(data.neighborhood), complement: optional(data.complement),
  };
}
