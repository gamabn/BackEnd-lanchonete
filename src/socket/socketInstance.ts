import type { Server } from "socket.io";

let io: Server | null = null;

export function setSocketInstance(server: Server) {
  io = server;
}

export function getSocketInstance(): Server {
  if (!io) {
    throw new Error("Socket.IO ainda não foi inicializado.");
  }

  return io;
}
