import type { Request, Response } from "express";
import type { CustomerPrincipal } from "../../security/customerAccess";
import { customerChatCredential } from "../../socket/chat";
import { restaurantRoom } from "../../socket/orders";
import { io } from "../../server";
import { OrderSalesService } from "../../service/order/OrderSalesService";
import { OrderValidationError } from "../../service/order/orderValidation";
import { EnviarWebPushService } from "../../service/webPushService/enviarWebPushService";

class OrderSalesController {
  async handle(req: Request, res: Response) {
    res.set("Cache-Control", "no-store");
    const actor = res.locals.customerPrincipal as CustomerPrincipal;
    if (actor.type !== "customer" || actor.restaurantId !== req.params.id)
      return res.status(403).json({ error: "Cliente não autorizado." });
    try {
      const result = await new OrderSalesService().execute({
        restaurant_id: actor.restaurantId,
        customer_id: actor.customerId,
        input: req.body,
      });
      // execute returns only after COMMIT. Never emit from the legacy item endpoint.
      try {
        io.of("/orders")
          .to(restaurantRoom(result.order.restaurant_id))
          .emit("newOrder", result.fullOrder);

        if (result) {
          const webPushService = new EnviarWebPushService();
          const name = result.fullOrder.customer.name;
          const price = result.subtotal;

          const delivery = await webPushService.handle({
            lanchonete_id: result.order.restaurant_id,
            titulo: "Novo pedido",
            mensagem: `${name} - ${price}`,
            url: "/dashboard",
          });
          console.log("✅ Resultado Web Push:", delivery);
        }
      } catch (error) {
        console.error(
          "❌ Pedido confirmado, mas a notificação Web Push falhou:",
          error,
        );
      }
      return res.status(201).json({
        ...result,
        chat_credential: customerChatCredential(
          result.order.id,
          result.order.customer_id,
        ),
      });
    } catch (error) {
      if (error instanceof OrderValidationError)
        return res.status(error.status).json({ error: error.message });
      return res
        .status(503)
        .json({ error: "Não foi possível confirmar o pedido." });
    }
  }
}
export { OrderSalesController };
