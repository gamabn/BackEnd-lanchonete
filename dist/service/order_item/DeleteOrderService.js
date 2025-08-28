"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeleteOrderService = void 0;
const database_1 = require("../../database");
class DeleteOrderService {
    async execute(order_id) {
        const client = await database_1.pool.connect();
        try {
            await client.query('BEGIN'); // Inicia a transação
            // 1. Primeiro, deleta os itens do pedido para evitar erro de chave estrangeira.
            await client.query('DELETE FROM order_items WHERE order_id = $1', [order_id]);
            // 2. Em seguida, deleta o pedido principal.
            const orderDeleteResult = await client.query('DELETE FROM orders WHERE id = $1', [order_id]);
            // Se nenhuma linha foi afetada, o pedido não existia.
            if (orderDeleteResult.rowCount === 0) {
                throw new Error('Pedido não encontrado.');
            }
            await client.query('COMMIT'); // Confirma a transação se tudo deu certo.
            return { message: 'Pedido excluído com sucesso' };
        }
        catch (error) {
            await client.query('ROLLBACK'); // Desfaz a transação em caso de erro.
            console.error("Erro ao deletar pedido:", error);
            throw error; // Propaga o erro para o controller.
        }
        finally {
            client.release(); // Libera a conexão de volta para o pool.
        }
    }
}
exports.DeleteOrderService = DeleteOrderService;
