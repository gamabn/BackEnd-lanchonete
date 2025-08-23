import { Request, Response } from "express";
import { DashboardService } from "../../service/order/DashboardService";



class DashboardController{
    async handle(req: Request, res: Response) {
           const restaurant_id = req.user_id;
        
        const dashboardService = new DashboardService();
        const dashboard = await dashboardService.execute(restaurant_id);

        return res.json(dashboard);
    }

}
export { DashboardController
}