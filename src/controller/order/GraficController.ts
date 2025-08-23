import  { Request, Response } from "express";
import { GraficService } from "../../service/order/GraficService";

class GraficController{
    async handle(req: Request, res: Response) {
            const restaurant_id = req.user_id;


        const graficService = new GraficService();
        const salesByMonth = await graficService.execute(restaurant_id);

        return res.json(salesByMonth);
    }

}
export { GraficController}