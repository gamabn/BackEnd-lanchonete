import type { Request, Response } from "express";
import { UpdateOrderService } from "../../service/order/UpdateOrderService";
import { restaurantRoom } from "../../socket/orders";
import { getSocketInstance } from "../../socket/socketInstance";

class UpdateOrderController {
  async handle(req: Request, res: Response) {
    try {
      const { id, status } = req.body;

      if (
        typeof id !== "string" ||
        !id ||
        !["pending", "enviado", "completed"].includes(status)
      ) {
        return res.status(400).json({
          error: "Pedido/status inválido.",
        });
      }

      const order = await new UpdateOrderService().execute({
        id,
        status,
        restaurant_id: req.user_id,
      });

      if (!order) {
        return res.status(404).json({
          error: "Pedido não encontrado.",
        });
      }

      // Notifica somente os dashboards deste restaurante.
      getSocketInstance()
        .of("/orders")
        .to(restaurantRoom(req.user_id))
        .emit("orderUpdated", {
          order_id: order.id,
          status: order.status,
        });

      console.log("📡 Status atualizado via Socket.IO:", {
        order_id: order.id,
        status: order.status,
      });

      return res.json(order);
    } catch (error) {
      console.error("Erro ao atualizar status do pedido:", error);

      return res.status(500).json({
        error: "Erro interno ao atualizar pedido.",
      });
    }
  }
}

export { UpdateOrderController };
