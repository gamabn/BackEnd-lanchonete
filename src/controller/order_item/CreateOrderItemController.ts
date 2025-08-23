import { Request, Response } from "express";
import { CreateOrderItemService } from "../../service/order_item/CreateOrderItemSerice";

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
      return res.status(201).json(insertedItems);
    } catch (error) {
      console.error("Erro ao inserir itens do pedido:", error);
      return res.status(500).json({ message: "Erro interno ao inserir itens." });
    }
  }
}

export { CreateOrderItemController };
