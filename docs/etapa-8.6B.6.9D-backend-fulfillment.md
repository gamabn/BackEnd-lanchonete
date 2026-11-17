# Etapa 8.6B.6.9D — DELIVERY e PICKUP no backend

## Resultado e escopo

POST /order/:id aceita fulfillment_type DELIVERY ou PICKUP. Omissão mantém DELIVERY. Não foram alterados rota, controller, middleware, frontend, dashboard, checkout, Gama Bot, status, pagamentos ou schema/migrations. Nenhuma conexão com Neon, migration ou modificação de dados reais foi executada nesta etapa. Os cinco históricos informados pelo operador não foram atualizados.

## Auditoria e regras

OrderSalesController continua exigindo CustomerPrincipal de cliente e restaurante igual ao parâmetro de rota. O serviço recebe restaurant_id/customer_id da identidade autenticada, não do corpo. O controller emite newOrder na sala do restaurante persistido somente depois do retorno do serviço, que ocorre depois de COMMIT. Falhas de persistência/COMMIT não emitem evento. Falha apenas de notificação mantém o sucesso de um pedido já confirmado.

OrderSalesService mantém BEGIN, bloqueios FOR SHARE de restaurante/cliente/produtos/variantes/adicionais, persistência de cabeçalho/itens/adicionais/chat, carregamento do pedido completo, COMMIT, ROLLBACK e liberação da conexão. Status do restaurante deve ser exatamente true. Cliente precisa pertencer ao restaurante mesmo quando não tem endereço e solicita retirada.

O parser aceita somente items, fulfillment_type, bairro_id, payment_method e change_for. Modalidade ausente vira DELIVERY; null, nomes diferentes, espaços ou caixa diferente são rejeitados. Identidade, snapshots, preços, subtotal, frete e total enviados pelo cliente continuam proibidos. Tipos/quantidades/UUIDs, configurações de produtos, duplicidades, pagamento e troco mantêm a validação anterior.

### DELIVERY

- bairro_id UUID obrigatório, inclusive em requisições legadas.
- Mantida a validação anterior de bairro não vazio no cadastro e correspondência com a região selecionada.
- Busca bairros pelo ID e lanchonete_id do restaurante autenticado, comparando o nome normalizado com o bairro cadastrado do cliente.
- Taxa real vem de bairros.frete dentro da transação; zero é válido, taxa negativa/inválida é rejeitada.
- Preços e adicionais são recalculados do banco, com centavos BigInt.
- Persiste subtotal, delivery_fee, total_price = subtotal + delivery_fee, bairro_id e snapshot delivery_address; pickup_address fica SQL NULL.
- As demais regras existentes de endereço não foram ampliadas nesta etapa. Não foi introduzido endereço por pedido recebido no corpo.

### PICKUP

- bairro_id pode ser omitido ou explicitamente null; qualquer outro valor é conflito e retorna 422 antes da transação.
- delivery_address e pickup_address no corpo são rejeitados, inclusive quando null: snapshots pertencem ao servidor.
- Não exige bairro/endereço do cliente e não consulta bairros para precificar.
- delivery_fee é calculado como 0.00; total_price corresponde somente ao subtotal dos produtos.
- O SELECT do restaurante, isolado pelo restaurant_id autenticado e bloqueado com FOR SHARE, traz status, name, street, number, neighborhood e city. Não há chamada HTTP nem consulta fora da transação.
- restaurantPickupAddress exige os cinco campos reais: name, street, number, neighborhood e city. Normaliza espaços e número finito; rejeita campos vazios, objetos, null/undefined, representações literais inválidas e caracteres de controle. Dados incompletos retornam erro 422 sem persistir pedido.
- pickup_address recebe snapshot { name, street, number, neighborhood, city }. Não há endereço fixo ou informado pelo cliente. bairro_id e delivery_address são SQL NULL.
- Nunca atualiza restaurants, customers, bairros ou endereço cadastrado.

## Leitura e históricos

GetOrderItemService agora retorna fulfillment_type, subtotal, delivery_fee, delivery_address e pickup_address no FullOrder, mantendo os campos anteriores.

DELIVERY mantém o snapshot de entrega quando existente e o fallback legado para o endereço atual do cliente quando não existe snapshot. Históricos financeiros desconhecidos permanecem NULL, sem reconstrução por preços/taxas atuais.

PICKUP retorna customer.city/street/number/neighborhood/complement como NULL e delivery_address como NULL. Identidade, nome e telefone do cliente permanecem presentes. Não aplica fallback de endereço do cliente; o local de retirada está em pickup_address. Listagem e leitura individual compartilham a mesma regra.

## Contratos e consumidores

Exemplo legado, sem modalidade:

```json
{
  "items": [{"product_id": "00000000-0000-4000-8000-000000000001", "quantity": 2}],
  "bairro_id": "00000000-0000-4000-8000-000000000004",
  "payment_method": "Pix",
  "change_for": "0"
}
```

Exemplo PICKUP:

```json
{
  "fulfillment_type": "PICKUP",
  "items": [{"product_id": "00000000-0000-4000-8000-000000000001", "quantity": 2}],
  "payment_method": "Pix",
  "change_for": "0"
}
```

Os UUIDs acima ilustram o formato; pedidos reais precisam de IDs do restaurante autenticado.

Resposta de criação preserva order/chat/fullOrder/subtotal/delivery_fee/change_due/chat_credential. order acrescenta modalidade, componentes financeiros em strings decimais e snapshot de retirada. FullOrder mantém valores monetários de apresentação numéricos; subtotal/frete podem ser NULL em históricos. O evento newOrder transporta o mesmo FullOrder com os novos campos, após COMMIT.

Checkout atual omite modalidade e continua criando DELIVERY. Consumidores que exibirem PICKUP precisam ler fulfillment_type e pickup_address. Dashboard, histórico/modal e comprovante atuais presumem endereço de entrega; não foram adaptados nesta etapa e podem apresentar campos vazios/null para retirada. Textos operacionais de status, como enviado, permanecem iguais. O bot continua apenas com as confirmações conversacionais anteriores, sem submissão de pedidos.

Não foi implementada idempotência persistente nesta etapa. O comportamento anterior de repetição de requisições permanece. Os limites monetários NUMERIC(12,2) do banco continuam valendo; falha de persistência provoca rollback, sem valores parciais.

## Arquivos alterados/criados

Produção:
- src/service/order/orderValidation.ts — contrato discriminado e modalidade padrão/conflitos.
- src/service/order/OrderSalesService.ts — ramificação transacional, snapshots e persistência financeira.
- src/service/order/pickupAddress.ts (novo) — validação/snapshot do restaurante.
- src/service/order_item/GetOrderItemService.ts — exposição da modalidade/valores e bloqueio de fallback em PICKUP.

Testes:
- tests/order-security.cjs — mocks atualizados e casos novos de modalidades, snapshots, preços, isolamento, erros e transação.
- tests/order-delivery-address.cjs — SQL real de INSERT/leitura em PostgreSQL descartável com schema atual e histórico.
- tests/fixtures/orders-fulfillment-schema.sql (novo) — representação descartável do schema já aplicado, incluindo CHECKs; não executa migration.
- tests/fixtures/legacy-order-insert.sql (novo) — SQL histórico de seis parâmetros, congelado para testes de compatibilidade de migrations anteriores.
- tests/order-fulfillment-migration.cjs e tests/frete-cleanup-migration.cjs — usam a fixture de INSERT histórico em vez de extrair o novo INSERT de onze parâmetros. Essas suítes de migration NÃO foram executadas nesta etapa; os arquivos SQL de migrations não foram alterados.
- docs/etapa-8.6B.6.9D-backend-fulfillment.md (novo) — este relatório.

## Validação executada

| Verificação | Resultado |
| --- | --- |
| node tests/order-security.cjs | 84 aprovados |
| node tests/order-delivery-address.cjs | 1 aprovado em PostgreSQL 18.6 descartável |
| node tests/orders-socket.cjs | 2 aprovados, 1 ignorado |
| node tests/customer-access.cjs | 10 aprovados |
| node tests/data-isolation.cjs | 19 aprovados |
| node tests/chat-security.cjs | 5 aprovados |
| npx tsc --noEmit | passou |
| git diff --check | passou |

Total: 121 aprovados, nenhuma falha e um teste de rede Socket.IO ignorado por EPERM. A ordem COMMIT -> evento é verificada por mocks do controller; conexão de socket real não foi comprovada no sandbox.

O teste PostgreSQL cria somente um cluster novo em /tmp com fixtures do schema já aplicado. Executa o INSERT extraído do serviço nas duas modalidades e as queries reais de listagem/leitura, validando persistência monetária, snapshots imutáveis e ausência de endereço do cliente em PICKUP. Não carrega dotenv/pool da aplicação, não usa DATABASE_URL, não abre listener e não executa migrations. O cluster é removido ao terminar.

Os testes de serviço usam dependências SQL simuladas e cobrem rollback em falhas de itens/adicionais/chat/leitura/COMMIT, restaurante ausente/fechado, cliente/produto de outro restaurante, configuração/preços, campos proibidos, conflitos de entrega, endereço real de retirada e duas requisições simultâneas isoladas por restaurante.
