import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors' ;
import { router, emailRoutes } from './routes'
import path from 'path';
import { createServer } from 'http';
import { Server } from 'socket.io';

const app = express()
const server = createServer(app)
const io = new Server(server,{
     connectionStateRecovery: {},
     cors: { origin: process.env.FRONTEND_URL }, // Apenas o seu frontend pode conectar
})

io.on("connection", (socket) => {
  console.log("Cliente conectado:", socket.id);

  // 🔹 Cliente entra em uma sala de chat
  socket.on("joinRoom", (chatId: string) => {
    socket.join(chatId);
    console.log(`Socket ${socket.id} entrou na sala ${chatId}`);
  });

    // Evento de digitando
  socket.on("typing", (data: { chatId: string; sender_id: string; isTyping: boolean }) => {
    io.to(data.chatId).emit("typing", data);
  });

  socket.on("disconnect", () => {
    console.log("Cliente desconectado:", socket.id);
  });
});
app.use(express.json())
app.use(cors({
   origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
   // origin: process.env.FRONTEND_URL // Apenas o seu frontend pode fazer requisições
}))


app.use('/email', emailRoutes);


app.use(router)

app.use(
    '/files',
    express.static(path.resolve(__dirname, '..', 'tmp'))
)

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    if (err instanceof Error) {
        // Se for uma instância de Error, sabemos que tem a propriedade message
        return res.status(400).json({
            error: err.message
        })
    }

    // Se não for um Error, pode ser qualquer outra coisa
    return res.status(500).json({
        status: 'error',
        message: 'Internal server error.'
    })
})
const PORT = process.env.PORT || 3333;
server.listen(PORT,()=> console.log('Servidor online!') )
export { io };