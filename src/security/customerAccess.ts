import { createHmac } from "crypto";
import { sign, verify } from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

export type CustomerPrincipal =
  | { type: "customer"; customerId: string; restaurantId: string }
  | { type: "restaurant"; restaurantId: string };
export interface CustomerData {
  name: string;
  phone: string;
  city: string;
  street?: string;
  number?: string;
  neighborhood?: string;
  complement?: string;
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
  } catch { /* A distinct key prevents chat/socket credentials from granting profile access. */ }
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
  } catch { return res.status(401).json({ error: "Credencial inválida ou expirada." }); }
  const requestedRestaurant = req.params.id || req.headers["x-customer-restaurant"];
  if (requestedRestaurant !== undefined && requestedRestaurant !== actor.restaurantId) {
    return res.status(403).json({ error: "Cadastro não autorizado." });
  }
  res.locals.customerPrincipal = actor;
  return next();
}
// Only contact/address data are writable. Internal fields never reach the SQL UPDATE.
export function readCustomerData(input: unknown): CustomerData | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const data = input as Record<string, unknown>;
  const writable = ["name", "phone", "city", "street", "number", "neighborhood", "complement"];
  if (Object.keys(data).some(key => !writable.includes(key))) return undefined;
  if (typeof data.name !== "string" || !data.name.trim() || typeof data.phone !== "string" ||
      !data.phone.trim() || typeof data.city !== "string" || !data.city.trim()) return undefined;
  for (const key of ["street", "number", "neighborhood", "complement"]) {
    if (data[key] !== undefined && typeof data[key] !== "string") return undefined;
  }
  return {
    name: data.name.trim(), phone: data.phone.trim(), city: data.city.trim(),
    street: typeof data.street === "string" ? data.street.trim() : undefined,
    number: typeof data.number === "string" ? data.number.trim() : undefined,
    neighborhood: typeof data.neighborhood === "string" ? data.neighborhood.trim() : undefined,
    complement: typeof data.complement === "string" ? data.complement.trim() : undefined,
  };
}
