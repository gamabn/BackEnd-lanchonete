import "dotenv/config";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import { router, emailRoutes } from "./routes";
import path from "path";
import { createServer } from "http";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import { configureChatSocket } from "./socket/chat";
import { configureOrdersSocket } from "./socket/orders";
import { setSocketInstance } from "./socket/socketInstance";
import { pool } from "./database";
import { ApiWhatsAppHost } from "./messaging/worker/apiHost";
import { readLocalBotConfig } from "./messaging/worker/config";
import {
  BotDiagnosticError,
  formatDiagnostic,
} from "./messaging/worker/diagnostics";
import { TenantWhatsAppSessionManager } from "./messaging/worker/tenantSessionManager";
import { createWhatsAppRouter } from "./messaging/http/whatsappRoutes";

const app = express();
const server = createServer(app);
//const io = new Server(server,{
//    connectionStateRecovery: {},
//    cors: { origin: process.env.FRONTEND_URL }, // Apenas o seu frontend pode conectar
//})

//======================================
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  },
  transports: ["websocket", "polling"], // 🔹 garante compatibilidade no Render
});
setSocketInstance(io);
configureOrdersSocket(io);

//======================================
// 🔹 Configura Redis Adapter (para não duplicar eventos entre instâncias)
async function setupSocketAdapter() {
  if (!process.env.REDIS_URL) {
    console.warn("⚠️ Nenhum REDIS_URL encontrado, rodando sem adapter.");
    return;
  }

  const pubClient = createClient({ url: process.env.REDIS_URL });
  const subClient = pubClient.duplicate();

  await Promise.all([pubClient.connect(), subClient.connect()]);
  io.adapter(createAdapter(pubClient, subClient));

  console.log("✅ Redis adapter conectado!");
}
const socketAdapterReady = setupSocketAdapter();
void socketAdapterReady.catch((err) => {
  console.error("Erro ao configurar Redis adapter:", err);
});

configureChatSocket(io);
let legacyReservedRestaurantId: string | undefined;
const tenantWhatsAppSessions = new TenantWhatsAppSessionManager(
  { database: pool, io },
  {
    root:
      process.env.WHATSAPP_AUTH_ROOT ||
      path.resolve(__dirname, "..", ".gama-whatsapp"),
    enabled: () => process.env.WHATSAPP_CONNECTION_ENABLED === "true",
    realCheckoutEnabled: process.env.WHATSAPP_REAL_CHECKOUT_ENABLED === "true",
    allowSimulation:
      process.env.NODE_ENV === "development" &&
      (process.env.WHATSAPP_REAL_CHECKOUT_ENABLED ?? "false") === "false",
    ready: () => socketAdapterReady,
    legacyReserved: (id) => legacyReservedRestaurantId === id,
    restoreFailed: (restaurantId, code) =>
      process.stderr.write(
        `[bot:restore] ${JSON.stringify({ restaurant_id: restaurantId, code })}\n`,
      ),
  },
);
//==============================================
app.use(express.json());
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    // origin: process.env.FRONTEND_URL // Apenas o seu frontend pode fazer requisições
  }),
);

app.use("/email", emailRoutes);
app.use("/whatsapp", createWhatsAppRouter(tenantWhatsAppSessions));

app.use(router);

app.use("/files", express.static(path.resolve(__dirname, "..", "tmp")));

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof Error) {
    // Se for uma instância de Error, sabemos que tem a propriedade message
    return res.status(400).json({
      error: err.message,
    });
  }

  // Se não for um Error, pode ser qualquer outra coisa
  return res.status(500).json({
    status: "error",
    message: "Internal server error.",
  });
});
const PORT = process.env.PORT || 3333;
const whatsappHost = new ApiWhatsAppHost(
  { database: pool, io },
  (value) => {
    const qr = require("qrcode-terminal") as {
      generate(value: string, options: { small: boolean }): void;
    };
    qr.generate(value, { small: true });
  },
  (message) => process.stdout.write(message + "\n"),
);

export async function startWhatsAppWorker(): Promise<void> {
  const config = readLocalBotConfig(process.env, process.cwd());
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new BotDiagnosticError(
      "terminal",
      "TTY_REQUIRED",
      "Inicie o host em terminal interativo para pareamento seguro.",
    );
  if (tenantWhatsAppSessions.hasSession(config.context.restaurant_id))
    throw new BotDiagnosticError(
      "configuration",
      "TENANT_WORKER_ACTIVE",
      "O restaurante já possui worker gerenciado pelo dashboard.",
    );
  legacyReservedRestaurantId = config.context.restaurant_id.toLowerCase();
  try {
    await socketAdapterReady;
    await whatsappHost.start(config);
  } catch (error) {
    legacyReservedRestaurantId = undefined;
    throw error;
  }
}
export const stopWhatsAppWorker = async () => {
  await whatsappHost.stop();
  legacyReservedRestaurantId = undefined;
};

// Keep listeners installed while draining: a second signal must not bypass cleanup.
// ts-node-dev disconnects its IPC channel before sending SIGTERM on a respawn.
let shutdownTask: Promise<void> | undefined;
const shutdown = () => {
  if (shutdownTask) return shutdownTask;
  shutdownTask = Promise.resolve().then(async () => {
    const results = await Promise.allSettled([
      stopWhatsAppWorker(),
      tenantWhatsAppSessions.stopAll(),
    ]);
    const failed = results.some((result) => result.status === "rejected");
    if (failed)
      process.stderr.write(
        "[bot:shutdown] Falha no encerramento de sessão; locks preservados.\n",
      );
    process.exit(failed ? 1 : 0);
  });
  return shutdownTask;
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
if (process.env.TS_NODE_DEV) process.on("disconnect", shutdown);

server.listen(PORT, () => {
  if (shutdownTask) return;

  console.log(`🚀 Servidor online na porta ${PORT}`);

  const whatsappWorkerEnabled = process.env.WHATSAPP_WORKER_ENABLED === "true";

  if (!whatsappWorkerEnabled) {
    console.log("🤖 Worker WhatsApp desabilitado neste ambiente.");
    return;
  }

  if (process.env.GAMA_BOT_API_HOST_ENABLED === "true") {
    void startWhatsAppWorker().catch((error) => {
      process.stderr.write(formatDiagnostic(error) + "\n");
    });
  }

  void tenantWhatsAppSessions
    .restore()
    .then((result) => {
      if (result.failed) {
        process.stderr.write(
          "[bot:restore] Algumas sessões não puderam ser restauradas.\n",
        );
      }
    })
    .catch(() => {
      process.stderr.write(
        "[bot:restore] Metadados de sessão indisponíveis; arquivos preservados.\n",
      );
    });
});
export { io, tenantWhatsAppSessions };
