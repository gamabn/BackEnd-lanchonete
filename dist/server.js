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
const app = (0, express_1.default)();
const server = (0, http_1.createServer)(app);
const io = new socket_io_1.Server(server, {
    connectionStateRecovery: {},
    cors: { origin: "*" }, // Permitir conexões de qualquer frontend
});
exports.io = io;
io.on("connection", (socket) => {
    console.log("Cliente conectado:", socket.id);
    // 🔹 Cliente entra em uma sala de chat
    socket.on("joinRoom", (chatId) => {
        socket.join(chatId);
        console.log(`Socket ${socket.id} entrou na sala ${chatId}`);
    });
    // Evento de digitando
    socket.on("typing", (data) => {
        io.to(data.chatId).emit("typing", data);
    });
    socket.on("disconnect", () => {
        console.log("Cliente desconectado:", socket.id);
    });
});
app.use(express_1.default.json());
app.use((0, cors_1.default)());
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
server.listen(3333, () => console.log('Servidor online!'));
