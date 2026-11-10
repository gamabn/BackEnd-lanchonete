import { createHmac } from "crypto";
import { sign, verify } from "jsonwebtoken";
import { Server } from "socket.io";
import type { Request, Response } from "express";

function ticketKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET não configurado");
  // A separate key prevents a socket ticket from authenticating HTTP requests.
  return createHmac("sha256", secret).update("gama-delivery:orders-socket:v1").digest();
}

export function createOrdersTicket(req: Request, res: Response) {
  const ticket = sign({}, ticketKey(), {
    algorithm: "HS256", subject: req.user_id, audience: "orders-socket",
    issuer: "gama-delivery", expiresIn: "5m",
  });
  return res.set("Cache-Control", "no-store").json({ ticket });
}

export const restaurantRoom = (id: string) => `restaurant:${id}`;

export function configureOrdersSocket(io: Server) {
  // Chat stays on the default namespace and cannot join these rooms.
  const orders = io.of("/orders");
  orders.use((socket, next) => {
    try {
      const ticket: unknown = socket.handshake.auth.ticket;
      if (typeof ticket !== "string") throw new Error("Missing ticket");
      const payload = verify(ticket, ticketKey(), {
        algorithms: ["HS256"], audience: "orders-socket", issuer: "gama-delivery",
      });
      if (typeof payload === "string" || !payload.sub || !payload.exp) throw new Error("Invalid ticket");
      socket.data.restaurantId = payload.sub;
      socket.data.expiresAt = payload.exp * 1000;
      next();
    } catch {
      next(new Error("Não autorizado"));
    }
  });
  orders.on("connection", (socket) => {
    void socket.join(restaurantRoom(socket.data.restaurantId));
    const timer = setTimeout(() => socket.disconnect(true), Math.max(0, socket.data.expiresAt - Date.now()));
    socket.on("disconnect", () => clearTimeout(timer));
  });
}
