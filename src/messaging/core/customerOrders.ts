import { GetOrderItemService } from "../../service/order_item/GetOrderItemService";
import {
  identifyCustomer,
  type CustomerReader,
} from "./customerIdentification";
import type { WhatsAppPhoneIdentity } from "../channels/whatsapp/phoneIdentity";
import { moneyCents } from "../../service/order/orderValidation";
import { formatPaymentMoney } from "./payment";

export type CustomerOrdersReader = Pick<GetOrderItemService, "listByCustomer">;
export const createCustomerOrdersReader = (): CustomerOrdersReader =>
  new GetOrderItemService();
export async function customerOrdersReply(
  restaurantId: string,
  identity: WhatsAppPhoneIdentity | undefined,
  customers: CustomerReader,
  orders: CustomerOrdersReader,
): Promise<string> {
  const back = "\n\n0 - Voltar ao menu principal";
  try {
    const customer = await identifyCustomer(restaurantId, identity, customers);
    if (customer.kind !== "found")
      return (
        "Não foi possível identificar seu cadastro com segurança para consultar pedidos." +
        back
      );
    const rows = await orders.listByCustomer(restaurantId, customer.customerId);
    if (
      rows.some(
        (row) =>
          row.restaurant_id !== restaurantId ||
          row.customer_id !== customer.customerId,
      )
    )
      throw new Error("Escopo incompatível");
    if (!rows.length)
      return (
        "📋 MEUS PEDIDOS\n\nVocê ainda não tem pedidos neste restaurante." +
        back
      );
    const statuses = new Map([
      ["pending", "PENDENTE"],
      ["enviado", "ENVIADO"],
      ["completed", "CONCLUÍDO"],
    ]);
    return (
      [
        "📋 MEUS PEDIDOS",
        "Últimos 10 pedidos",
        "",
        ...rows
          .slice(0, 10)
          .map(
            (row) =>
              `Pedido #${row.order_id}\nStatus: ${statuses.get(row.status) ?? row.status}\nTotal: ${formatPaymentMoney(moneyCents(row.total_price))}`,
          ),
      ].join("\n\n") + back
    );
  } catch {
    return (
      "Não foi possível consultar seus pedidos agora. Tente novamente mais tarde." +
      back
    );
  }
}
