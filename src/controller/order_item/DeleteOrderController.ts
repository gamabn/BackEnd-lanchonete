import { Request, Response } from "express";
import { DeleteOrderService } from "../../service/order_item/DeleteOrderService";


class DeleteOrderController {
  async handle(req: Request, res: Response) {
    // É mais comum receber o ID como parâmetro de rota (ex: /order/:id)
    // mas vamos manter como corpo da requisição para bater com seu frontend.
    const { id: order_id } = req.body;

    if (!order_id) {
      return res.status(400).json({ error: 'ID do pedido é obrigatório.' });
    }

    const deleteOrderService = new DeleteOrderService();

    try {
      const result = await deleteOrderService.execute(order_id as string);
      return res.json(result);
    } catch (error: any) {
      // Retorna um erro mais específico se o pedido não for encontrado
      if (error.message === 'Pedido não encontrado.') {
        return res.status(404).json({ error: error.message });
      }
      // Erro genérico do servidor
      return res.status(500).json({ error: 'Erro interno ao excluir o pedido.' });
    }
  }
}

export { DeleteOrderController };
