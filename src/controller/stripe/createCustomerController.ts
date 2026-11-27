import { Request, Response } from "express";
import { CreateCustomerService } from "../../service/stripe/createCustomerService";

class CreateCustomerController {
  async handle(req: Request, res: Response) {
    const { email } = req.body;
    const restaurant_id = req.user_id;

    if (!restaurant_id) {
      return res.status(401).json({
        error: "Restaurante não autenticado.",
      });
    }

    if (!email || typeof email !== "string") {
      return res.status(400).json({
        error: "Informe um e-mail válido.",
      });
    }

    const service = new CreateCustomerService();

    const payment = await service.execulte(email, restaurant_id);

    return res.status(200).json(payment);
  }
}

export { CreateCustomerController };
