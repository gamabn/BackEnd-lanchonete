import { Request, response, Response } from "express";
import { bairroService } from "../../service/bairro/bairroService";

const service = new bairroService();

export class BairroController {
  async criarBairro(req: Request, res: Response) {
    try {
      const { bairro, valor } = req.body;
      const lanchonete_id = req.user_id;

      if (
        typeof bairro !== "string" ||
        !bairro.trim() ||
        valor === undefined ||
        valor === null ||
        valor === ""
      ) {
        return res.status(400).json({
          error: "Bairro e valor são obrigatórios.",
        });
      }

      const frete = Number(valor);

      if (!Number.isFinite(frete) || frete < 0) {
        return res.status(400).json({
          error: "O frete deve ser um valor válido maior ou igual a zero.",
        });
      }

      if (!lanchonete_id) {
        return res.status(401).json({
          error: "Usuário não autenticado.",
        });
      }

      const resultado = await service.criar({
        bairro: bairro.trim(),
        valor: frete,
        lanchonete_id,
      });

      if (!resultado) return res.status(404).json({ error: "Estabelecimento não encontrado." });
      return res.status(201).json(resultado);
    } catch (error) {
      console.error("Erro ao cadastrar bairro:", error);

      return res.status(500).json({
        error: "Erro ao cadastrar bairro.",
      });
    }
  }

  async getBairrosPublicos(req: Request, res: Response) {
    try {
      const { lanchonete_id } = req.params;

      if (!lanchonete_id || Array.isArray(lanchonete_id)) {
        return res.status(400).json({
          error: "ID da lanchonete é obrigatório.",
        });
      }

      const bairros = await service.getBairro(lanchonete_id);

      return res.status(200).json(bairros);
    } catch (error) {
      console.error("Erro ao buscar bairros públicos:", error);

      return res.status(500).json({
        error: "Erro ao consultar bairros.",
      });
    }
  }

  async getBairroId(req: Request, res: Response) {
    //  const { lanchonete_id } = req.params;
    const lanchonete_id = req.user_id;
    if (!lanchonete_id) {
      return res.status(400).json({ error: "Id e obrigatorio" });
    }
    // const service = new bairroService()
    const serviceIdBairro = await service.getBairro(lanchonete_id);
    return res.json(serviceIdBairro);
  }

  async deletarBairro(req: Request, res: Response) {
    const { id } = req.params;

    const deletar_bairro = await service.DeletarBairro(id, req.user_id);
    if (!deletar_bairro) return res.status(404).json({ error: "Bairro não encontrado." });
    return res.json(deletar_bairro);
  }

  async editarBairro(req: Request, res: Response) {
    const { id } = req.params;
    const { bairro, frete } = req.body;

    const value = Number(frete);
    if (typeof bairro !== "string" || !bairro.trim() || frete === undefined || frete === null || frete === "" || !Number.isFinite(value) || value < 0) {
      return res.status(400).json({ error: "Bairro e frete inválidos." });
    }
    const editBairro = await service.edit(id, bairro.trim(), value, req.user_id);
    if (!editBairro) return res.status(404).json({ error: "Bairro não encontrado." });
    return res.json(editBairro);
  }
}
