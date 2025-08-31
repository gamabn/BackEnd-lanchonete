import { Request, Response } from "express";
import { CreateOrderItemService } from "../../service/order_item/CreateOrderItemSerice";
import { GetOrderItemService } from "../../service/order_item/GetOrderItemService";
import { io } from "../../server";


class CreateOrderItemController {
  async handle(req: Request, res: Response) {
    // Aceita tanto array direto quanto { items: [...] }
    const items = Array.isArray(req.body) ? req.body : req.body.items;
    console.log('Item dos pedidos', items)

    if (!items || !items.length) {
      return res.status(400).json({ message: "Array de itens é obrigatório." });
    }

    try {
      const service = new CreateOrderItemService();
      const insertedItems = await service.execute(items);

       const orderId = insertedItems[0]?.order_id;

      if (!orderId) {
        console.error("Não foi possível determinar order_id:", insertedItems);
        return res.status(500).json({ message: "Erro ao identificar pedido inserido." });
      }

      const getOrderService = new GetOrderItemService();
      const fullOrder = await getOrderService.findByOrderId(orderId);
      
      if (!fullOrder) {
        return res.status(404).json({ message: "Pedido não encontrado." });
      }

       // emite o pedido completo
      io.emit("newOrder", fullOrder);
      console.log("Emitindo newOrder:", fullOrder.order_id);

      return res.status(201).json(fullOrder);

    } catch (error) {
      console.error("Erro ao inserir itens do pedido:", error);
      return res.status(500).json({ message: "Erro interno ao inserir itens." });
    }
  }
}

export { CreateOrderItemController };
