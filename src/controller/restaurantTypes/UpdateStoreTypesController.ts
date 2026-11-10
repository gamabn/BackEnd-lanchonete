import type { Request, Response } from "express";

import {
  UpdateStoreTypesService,
  StoreTypesValidationError,
} from "../../service/restaurantTypes/UpdateStoreTypesService";

export class UpdateStoreTypesController {
  async handle(req: Request, res: Response): Promise<void> {
    try {
      const restaurantId = req.user_id;

      if (!restaurantId) {
        res.status(401).json({
          error: "Estabelecimento não autenticado.",
        });
        return;
      }

      const { primaryTypeId, additionalTypeIds = [] } = req.body ?? {};

      const service = new UpdateStoreTypesService();

      const types = await service.execute({
        restaurantId,
        primaryTypeId,
        additionalTypeIds,
      });

      res.status(200).json({
        message: "Categorias atualizadas com sucesso.",
        types,
      });
    } catch (error) {
      if (error instanceof StoreTypesValidationError) {
        res.status(400).json({
          error: error.message,
        });
        return;
      }

      console.error("Erro ao atualizar categorias:", error);

      res.status(500).json({
        error: "Erro interno ao atualizar categorias.",
      });
    }
  }
}
