import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { verify } from "jsonwebtoken";
import { isTenantUUID } from "../worker/tenantSessionStore";
import {
  WhatsAppSessionError,
  type TenantWhatsAppSessionManager,
} from "../worker/tenantSessionManager";

type Sessions = Pick<
  TenantWhatsAppSessionManager,
  "connect" | "disconnect" | "status" | "qr"
>;

/** Same owner JWT issued by AuthStoreService; customer/chat/socket purpose tokens are rejected. */
export function whatsappOwnerAuthentication(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  res.set("Cache-Control", "no-store, private");
  res.set("Pragma", "no-cache");
  res.set("Vary", "Authorization");
  try {
    const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    if (!token || !process.env.JWT_SECRET)
      throw new Error("Missing owner credential");
    const payload = verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
    });
    if (
      typeof payload === "string" ||
      !isTenantUUID(payload.sub) ||
      payload.aud !== undefined ||
      typeof payload.exp !== "number"
    )
      throw new Error("Invalid owner credential");
    req.user_id = payload.sub.toLowerCase();
    next();
  } catch {
    res.status(401).json({ error: "UNAUTHORIZED" });
  }
}

export function createWhatsAppRouter(sessions: Sessions) {
  const router = Router();

  router.use(whatsappOwnerAuthentication);

  // Impede operações WhatsApp quando o worker está desabilitado.
  router.use((req: Request, res: Response, next: NextFunction) => {
    if (process.env.WHATSAPP_WORKER_ENABLED !== "true") {
      return res.status(503).json({
        error: "WHATSAPP_WORKER_DISABLED",
      });
    }

    next();
  });

  /* router.use((req: Request, res: Response, next: NextFunction) => {
    if (process.env.WHATSAPP_WORKER_ENABLED !== "true") {
      return res.status(503).json({
        error: "WHATSAPP_WORKER_DISABLED",
      });
    }

    next();
  }); */

  const action =
    (method: keyof Sessions, status = 200) =>
    async (req: Request, res: Response) => {
      try {
        const result = await sessions[method](req.user_id);

        res.status(status).json(result);
      } catch (error) {
        if (error instanceof WhatsAppSessionError) {
          res.status(error.status).json({
            error: error.code,
          });
        } else {
          res.status(503).json({
            error: "WHATSAPP_UNAVAILABLE",
          });
        }
      }
    };

  router.post("/connect", action("connect", 202));
  router.get("/status", action("status"));
  router.get("/qr", action("qr"));
  router.post("/disconnect", action("disconnect"));

  return router;
}
