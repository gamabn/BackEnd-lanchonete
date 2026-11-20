import { Request, Response } from "express";
import { SalvarWebPushService } from "../../service/webPushService/salvarWebPushService";

class WebPushController {
  async handler(req: Request, res: Response) {
    try {
      const lanchonete_id = req.user_id;

      if (!lanchonete_id) {
        return res.status(401).json({ error: "Lanchonete nao encontrada" });
      }

      const { endpoint, keys } = req.body;

      if (
        typeof endpoint !== "string" ||
        !endpoint.startsWith("https://") ||
        !keys ||
        typeof keys.p256dh !== "string" ||
        typeof keys.auth !== "string" ||
        !keys.p256dh ||
        !keys.auth
      ) {
        return res.status(400).json({ error: "Inscriçao Web Push invalida" });
      }

      const service = new SalvarWebPushService();

      const inscriçao = await service.execute({
        lanchonete_id,
        endpoint,
        keys,
      });

      return res.status(200).json({
        message: "Inscriçao salva com sucesso",
        inscriçao,
      });
    } catch (error) {
      console.error("Erro ao salvar web push:", error);
      return res.status(500).json({
        error: "Erro ao salvar Web Push",
      });
    }
  }
}

export { WebPushController };
