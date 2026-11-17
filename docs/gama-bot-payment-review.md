# Etapa 8.6B.6.9G — pagamento e revisão

Retirada e entrega confirmadas abrem PAYMENT_SELECTION. PIX, débito e crédito
abrem ORDER_REVIEW. Dinheiro passa por PAYMENT_CHANGE e, se solicitado,
PAYMENT_CHANGE_AMOUNT. O valor para troco aceita vírgula ou ponto decimal,
até duas casas e oito dígitos inteiros, sem separadores de milhares. Valores
menores que o total são recusados. Valor igual ao total é permitido.

A revisão mostra itens, quantidades, subtotais, modalidade, endereço,
taxa de entrega, total provisório, pagamento e troco. A opção 0 limpa o
pagamento e retorna à seleção; outro 0 retorna ao carrinho. A opção 1
entra em ORDER_SIMULATED. Repetir a confirmação não cria nenhum efeito.
Não há gravação de pedido, cobrança ou emissão Socket.IO nesta etapa.

Os cálculos reutilizam moneyCents/moneyText e usam bigint. Um snapshot
em memória vincula pagamento a restaurante, cliente, identidade, carrinho,
modalidade, endereço e região/taxa. Mudanças invalidam pagamento e revisão
antes de processar outra entrada. O isolamento continua por restaurante,
sessão e remetente. O snapshot não substitui uma consulta atual ao banco:
preços, disponibilidade e endereços podem mudar externamente.

Próxima etapa: revalidar identidade, disponibilidade, produtos, preços,
endereço e taxa no backend; criar o pedido em transação com idempotência;
emitir Socket.IO somente após o commit. Não usar o resumo provisório como
fonte de preços ou autorização para persistência.
