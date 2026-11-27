import { Request, Response } from "express";
import { WebhookStripe } from "../../service/stripe/webhookStripeService";

class WebhookStripeController {
  async handle(req: Request, res: Response) {
    try {
      const service = new WebhookStripe();

      const result = await service.execulte(req);

      return res.status(200).json(result);
    } catch (error) {
      console.error("Erro no webhook Stripe:", error);

      const message =
        error instanceof Error ? error.message : "Erro desconhecido";

      const isValidationError =
        message.includes("Assinatura do webhook") ||
        message.includes("Falha na validação do webhook") ||
        message.includes("Corpo bruto do webhook");

      return res.status(isValidationError ? 400 : 500).json({
        error: isValidationError
          ? "Webhook Stripe inválido."
          : "Erro interno ao processar webhook.",
      });
    }
  }
}

export { WebhookStripeController };
