import type { Request, Response } from "express";
import { GetRestaurantTypesService } from "../../service/restaurantTypes/GetRestaurantTypesService";

export class GetRestaurantTypesController {
  async handle(req: Request, res: Response): Promise<void> {
    try {
      const service = new GetRestaurantTypesService();

      const types = await service.execute();

      res.status(200).json(types);
    } catch (error) {
      console.error("Erro ao consultar tipos de estabelecimentos:", error);

      res.status(500).json({
        error: "Erro ao consultar tipos de estabelecimentos.",
      });
    }
  }
}
