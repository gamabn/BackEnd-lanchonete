import type { Request, Response } from "express";
import { UpdateProductOptionService } from "../../service/productOptions/UpdateProductOptionService";

export class UpdateProductOptionController {
  async handle(req: Request, res: Response): Promise<void> {
    try {
      const restaurantId = req.user_id;
      const { optionId } = req.params;

      if (!restaurantId) {
        res.status(401).json({
          error: "Estabelecimento não autenticado.",
        });
        return;
      }

      if (
        typeof optionId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          optionId,
        )
      ) {
        res.status(400).json({
          error: "ID do ingrediente inválido.",
        });
        return;
      }

      const { name, additionalPrice, available } = req.body ?? {};

      if (
        name === undefined &&
        additionalPrice === undefined &&
        available === undefined
      ) {
        res.status(400).json({
          error: "Informe pelo menos um campo para atualizar.",
        });
        return;
      }

      if (
        (name !== undefined && (typeof name !== "string" || !name.trim())) ||
        (additionalPrice !== undefined &&
          (typeof additionalPrice !== "number" ||
            !Number.isFinite(additionalPrice) ||
            additionalPrice < 0)) ||
        (available !== undefined && typeof available !== "boolean")
      ) {
        res.status(400).json({
          error: "Dados inválidos para atualização.",
        });
        return;
      }

      const service = new UpdateProductOptionService();

      const option = await service.execute({
        restaurantId,
        optionId,
        name,
        additionalPrice,
        available,
      });

      if (!option) {
        res.status(404).json({
          error: "Ingrediente não encontrado.",
        });
        return;
      }

      res.status(200).json({
        message: "Ingrediente atualizado com sucesso.",
        option,
      });
    } catch (error: unknown) {
      console.error("Erro ao atualizar ingrediente:", error);

      const pgError = error as { code?: string };

      if (pgError?.code === "23505") {
        res.status(409).json({
          error: "Já existe um ingrediente com esse nome neste grupo.",
        });
        return;
      }

      res.status(500).json({
        error: "Erro interno ao atualizar ingrediente.",
      });
    }
  }
}
