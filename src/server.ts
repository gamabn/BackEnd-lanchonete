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
     cors: { origin: "*" }, // Permitir conexões de qualquer frontend
})
io.on("connection", (socket) => {
  console.log("Cliente conectado:", socket.id);

  socket.on("disconnect", () => {
    console.log("Cliente desconectado:", socket.id);
  });
});

app.use(express.json())
app.use(cors())


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

server.listen(3333,()=> console.log('Servidor online!') )
export { io };