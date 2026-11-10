import { createHmac } from "crypto";
import { sign, verify } from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import type { Server } from "socket.io";
import { pool } from "../database";

type Actor = { type: "restaurant"; id: string } | { type: "customer"; id: string; orderId: string };
function key(purpose: string) {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET não configurado");
  return createHmac("sha256", process.env.JWT_SECRET).update(`gama:chat:${purpose}:v1`).digest();
}
export function customerChatCredential(orderId: string, customerId: string) {
  return sign({ orderId }, key("customer"), { subject: customerId, audience: "customer-chat", expiresIn: "7d", algorithm: "HS256" });
}
export function authenticateChat(token: string): Actor {
  try {
    const p = verify(token, key("customer"), { algorithms: ["HS256"], audience: "customer-chat" });
    if (typeof p !== "string" && p.sub && typeof p.orderId === "string") return { type: "customer", id: p.sub, orderId: p.orderId };
  } catch { /* Try the existing owner session next. */ }
  const p = verify(token, process.env.JWT_SECRET as string, { algorithms: ["HS256"] });
  if (typeof p === "string" || !p.sub || p.aud) throw new Error("Não autorizado");
  return { type: "restaurant", id: p.sub };
}
export async function authorizedChat(actor: Actor, id: string, byOrder = false) {
  const result = await pool.query<{ chat_id: string; order_id: string; restaurant_id: string; customer_id: string; customer_name: string; restaurant_name: string }>(
    `SELECT c.id AS chat_id, o.id AS order_id, o.restaurant_id, o.customer_id,
      cu.name AS customer_name, r.name AS restaurant_name
     FROM chats c JOIN orders o ON o.id = c.order_id AND c.restaurant_id = o.restaurant_id
     JOIN customers cu ON cu.id = o.customer_id AND cu.restaurant_id = o.restaurant_id
     JOIN restaurants r ON r.id = o.restaurant_id
     WHERE ${byOrder ? "o.id" : "c.id"} = $1 AND ${actor.type === "restaurant" ? "o.restaurant_id = $2" : "o.customer_id = $2 AND o.id = $3"}`,
    actor.type === "restaurant" ? [id, actor.id] : [id, actor.id, actor.orderId]);
  return result.rows[0];
}
export async function chatGuard(req: Request, res: Response, next: NextFunction) {
  res.set("Cache-Control", "no-store");
  let actor: Actor;
  try { actor = authenticateChat(req.headers.authorization?.replace(/^Bearer /, "") || ""); }
  catch { return res.status(401).json({ error: "Não autenticado" }); }
  try {
    const id: unknown = req.params.order_id || req.params.chat_id || req.body?.chat_id;
    if (typeof id !== "string") return res.status(400).json({ error: "Conversa obrigatória" });
    const chat = await authorizedChat(actor, id, Boolean(req.params.order_id));
    if (!chat || (req.method === "DELETE" && actor.type !== "restaurant")) return res.status(403).json({ error: "Conversa não autorizada" });
    res.locals.chatActor = actor;
    res.locals.authorizedChat = chat;
    next();
  } catch { return res.status(503).json({ error: "Não foi possível autorizar a conversa" }); }
}
export function chatTicket(req: Request, res: Response) {
  const actor = res.locals.chatActor as Actor;
  const chat = res.locals.authorizedChat as { chat_id: string };
  const ticket = sign({ actor, chatId: chat.chat_id }, key("socket"), { audience: "chat-socket", expiresIn: "5m", algorithm: "HS256" });
  return res.set("Cache-Control", "no-store").json({ ticket });
}
export const chatRoom = (id: string) => `chat:${id}`;
export function configureChatSocket(io: Server) {
  io.on("connection", socket => {
    const grants = new Map<string, { actor: Actor; expires: number; timer: ReturnType<typeof setTimeout> }>();
    socket.on("joinRoom", async (input: unknown, ack?: (result: { ok: boolean }) => void) => {
      try {
        if (!input || typeof input !== "object" || !("ticket" in input) || typeof input.ticket !== "string") throw new Error();
        const p = verify(input.ticket, key("socket"), { algorithms: ["HS256"], audience: "chat-socket" });
        if (typeof p === "string" || !p.exp || typeof p.chatId !== "string") throw new Error();
        const actor = p.actor as Actor;
        if (!actor || !await authorizedChat(actor, p.chatId)) throw new Error();
        if (!socket.connected) return;
        const id = p.chatId;
        const old = grants.get(id); if (old) clearTimeout(old.timer);
        await socket.join(chatRoom(id));
        const timer = setTimeout(() => { grants.delete(id); void socket.leave(chatRoom(id)); socket.emit("chatExpired", id); }, Math.max(0, p.exp * 1000 - Date.now()));
        grants.set(id, { actor, expires: p.exp * 1000, timer });
        if (typeof ack === "function") ack({ ok: true });
      } catch { if (typeof ack === "function") ack({ ok: false }); }
    });
    socket.on("leaveRoom", (id: unknown) => {
      if (typeof id !== "string") return;
      const grant = grants.get(id); if (grant) clearTimeout(grant.timer);
      grants.delete(id); void socket.leave(chatRoom(id));
    });
    socket.on("typing", (data: unknown) => {
      if (!data || typeof data !== "object" || !("chatId" in data) || typeof data.chatId !== "string") return;
      const grant = grants.get(data.chatId);
      if (!grant || grant.expires <= Date.now()) return;
      socket.to(chatRoom(data.chatId)).emit("typing", { chatId: data.chatId, sender_id: grant.actor.id, sender_type: grant.actor.type, isTyping: "isTyping" in data && data.isTyping === true });
    });
    socket.on("disconnect", () => { grants.forEach(grant => clearTimeout(grant.timer)); grants.clear(); });
  });
}
