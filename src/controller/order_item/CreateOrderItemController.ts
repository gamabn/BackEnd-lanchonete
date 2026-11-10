import type { Request, Response } from "express";
class CreateOrderItemController {
  async handle(_req: Request, res: Response) {
    return res.status(409).json({ error: "Envie os itens junto ao pedido em POST /order/:id. Itens não podem ser adicionados separadamente." });
  }
}
export { CreateOrderItemController };
