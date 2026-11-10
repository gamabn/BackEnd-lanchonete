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
setupSocketAdapter().catch((err) => {
  console.error("Erro ao configurar Redis adapter:", err);
});

configureChatSocket(io);
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
server.listen(PORT, () => console.log("Servidor online!"));
export { io };
