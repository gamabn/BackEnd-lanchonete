import { EditStatusService } from "../../service/user/ EditStatusService";
import type { Request, Response } from "express";
import { io } from "../../server";


class EditStatusController{

  async handle(req: Request, res: Response) {
    const { status } = req.body;
    const user_id = req.user_id;
    if (typeof status !== "boolean") return res.status(400).json({ error: "Status inválido." });

    const editStatusService = new EditStatusService();

    const updatedStore = await editStatusService.execute({
      id: user_id,
      status,
    });

    if (!updatedStore) return res.status(404).json({ error: "Estabelecimento não encontrado." });
        // 🔥 Emite o evento de status atualizado
    console.log("Emitindo statusUpdated:", updatedStore);
    io.emit("statusUpdated", {
      id: updatedStore.id,
      status: updatedStore.status,
    });


    return res.json(updatedStore);
  }

}
export  { EditStatusController }