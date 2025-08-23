import { pool } from "../../database"

interface OrderSales{
    id: string;
    status: string;
}


class UpdateOrderService{
    async execute({id, status}: OrderSales){
        const orderUpdate = await pool.query(
            'UPDATE orders SET status = $1 WHERE id = $2',
            [status, id]
        )

    }
}
export { UpdateOrderService }