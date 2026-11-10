import type { Request, Response } from "express";
import { CreateProductOptionService } from "../../service/productOptions/CreateProductOptionService";

export class CreateProductOptionController {
  async handle(req: Request, res: Response): Promise<void> {
    try {
      const restaurantId = req.user_id;
      const { groupId, name, additionalPrice = 0 } = req.body ?? {};

      if (!restaurantId) {
        res.status(401).json({
          error: "Estabelecimento não autenticado.",
        });
        return;
      }

      if (
        typeof groupId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          groupId,
        )
      ) {
        res.status(400).json({
          error: "ID do grupo inválido.",
        });
        return;
      }

      if (typeof name !== "string" || !name.trim()) {
        res.status(400).json({
          error: "Informe o nome do ingrediente.",
        });
        return;
      }

      if (
        typeof additionalPrice !== "number" ||
        !Number.isFinite(additionalPrice) ||
        additionalPrice < 0
      ) {
        res.status(400).json({
          error: "Preço adicional inválido.",
        });
        return;
      }

      const service = new CreateProductOptionService();

      const option = await service.execute({
        restaurantId,
        groupId,
        name: name.trim(),
        additionalPrice,
      });

      res.status(201).json({
        message: "Ingrediente cadastrado com sucesso.",
        option,
      });
    } catch (error: unknown) {
      console.error("Erro ao cadastrar ingrediente:", error);

      if (error instanceof Error) {
        if (
          error.message ===
          "Grupo não encontrado ou não pertence ao restaurante."
        ) {
          res.status(404).json({ error: error.message });
          return;
        }
      }

      const pgError = error as { code?: string };

      if (pgError?.code === "23505") {
        res.status(409).json({
          error: "Já existe um ingrediente com esse nome neste grupo.",
        });
        return;
      }

      res.status(500).json({
        error: "Erro interno ao cadastrar ingrediente.",
      });
    }
  }
}
