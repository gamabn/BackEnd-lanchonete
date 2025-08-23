
import { Request, Response } from "express";
import { OrderSalesService } from "../../service/order/OrderSalesService";

class OrderSalesController{
    async handle(req: Request, res: Response) {
        const { customer_id, status, total_price, payment_method, change_for } = req.body;
        const restaurant_id = req.params.id;



        const orderSalesService = new OrderSalesService();
        const order = await orderSalesService.execute({
            restaurant_id,
            customer_id,
            status,
            total_price,
            payment_method,
            change_for
        });

        return res.json(order);
    }

}
export { OrderSalesController }