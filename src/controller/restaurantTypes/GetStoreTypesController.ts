import type { Request, Response } from "express";
import { GetStoreTypesService } from "../../service/restaurantTypes/GetStoreTypesService";

export class GetStoreTypesController {
  async handle(req: Request, res: Response): Promise<void> {
    const { restaurantId } = req.params;

    if (
      typeof restaurantId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        restaurantId,
      )
    ) {
      res.status(400).json({
        error: "ID do estabelecimento inválido.",
      });
      return;
    }

    try {
      const service = new GetStoreTypesService();
      const types = await service.execute(restaurantId);

      res.status(200).json(types);
    } catch (error) {
      console.error("Erro ao buscar categorias:", error);

      res.status(500).json({
        error: "Erro ao buscar categorias do estabelecimento.",
      });
    }
  }
}
