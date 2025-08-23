
import { Request, Response } from "express";
import { UpdateOrderService } from "../../service/order/UpdateOrderService";

class UpdateOrderController {
    async handle(req: Request, res: Response) {
        const { id, status } = req.body;

        const updateOrderService = new UpdateOrderService();
        const order = await updateOrderService.execute({ id, status });

        return res.json(order);
    }

}
export { UpdateOrderController}