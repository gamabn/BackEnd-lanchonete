import type { Request, Response } from "express";
import { DeleteOrderService } from "../../service/order_item/DeleteOrderService";
class DeleteOrderController {
  async handle(req: Request, res: Response) {
    const { id } = req.body;
    if (typeof id !== "string" || !id) return res.status(400).json({ error: "Pedido obrigatório." });
    try {
      const result = await new DeleteOrderService().execute(id, req.user_id);
      if (!result) return res.status(404).json({ error: "Pedido não encontrado." });
      return res.json(result);
    } catch { return res.status(503).json({ error: "Não foi possível excluir o pedido." }); }
  }
}
export { DeleteOrderController };
