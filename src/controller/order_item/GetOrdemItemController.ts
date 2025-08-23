import { Request, Response } from "express";
import { GetOrderItemService } from "../../service/order_item/GetOrderItemService";


class GetOrdemItemController{

  async handle(req: Request, res: Response) {
    const restaurant_id  = req.user_id;

    const getOrderItemService = new GetOrderItemService();
    const orderItem = await getOrderItemService.execute(restaurant_id as string);

    return res.json(orderItem);
  }

}
export { GetOrdemItemController }