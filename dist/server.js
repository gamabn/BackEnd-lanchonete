"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.io = void 0;
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const routes_1 = require("./routes");
const path_1 = __importDefault(require("path"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const redis_adapter_1 = require("@socket.io/redis-adapter");
const redis_1 = require("redis");
const chat_1 = require("./socket/chat");
const orders_1 = require("./socket/orders");
const app = (0, express_1.default)();
const server = (0, http_1.createServer)(app);
//const io = new Server(server,{
//    connectionStateRecovery: {},
//    cors: { origin: process.env.FRONTEND_URL }, // Apenas o seu frontend pode conectar
//})
//======================================
const io = new socket_io_1.Server(server, {
    cors: {
        origin: process.env.FRONTEND_URL || "*",
        methods: ["GET", "POST"],
        allowedHeaders: ["Content-Type", "Authorization"],
    },
    transports: ["websocket", "polling"], // 🔹 garante compatibilidade no Render
});
exports.io = io;
(0, orders_1.configureOrdersSocket)(io);
//======================================
// 🔹 Configura Redis Adapter (para não duplicar eventos entre instâncias)
async function setupSocketAdapter() {
    if (!process.env.REDIS_URL) {
        console.warn("⚠️ Nenhum REDIS_URL encontrado, rodando sem adapter.");
        return;
    }
    const pubClient = (0, redis_1.createClient)({ url: process.env.REDIS_URL });
    const subClient = pubClient.duplicate();
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter((0, redis_adapter_1.createAdapter)(pubClient, subClient));
    console.log("✅ Redis adapter conectado!");
}
setupSocketAdapter().catch(err => {
    console.error("Erro ao configurar Redis adapter:", err);
});
(0, chat_1.configureChatSocket)(io);
//==============================================
app.use(express_1.default.json());
app.use((0, cors_1.default)({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    // origin: process.env.FRONTEND_URL // Apenas o seu frontend pode fazer requisições
}));
app.use('/email', routes_1.emailRoutes);
app.use(routes_1.router);
app.use('/files', express_1.default.static(path_1.default.resolve(__dirname, '..', 'tmp')));
app.use((err, req, res, next) => {
    if (err instanceof Error) {
        // Se for uma instância de Error, sabemos que tem a propriedade message
        return res.status(400).json({
            error: err.message
        });
    }
    // Se não for um Error, pode ser qualquer outra coisa
    return res.status(500).json({
        status: 'error',
        message: 'Internal server error.'
    });
});
const PORT = process.env.PORT || 3333;
server.listen(PORT, () => console.log('Servidor online!'));
