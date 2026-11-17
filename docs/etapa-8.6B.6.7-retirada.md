# Etapa 8.6B.6.7 — retirada com endereço real

Implementação limitada à confirmação conversacional da modalidade. Nenhum pedido é criado.

## Arquivos desta etapa

- `src/messaging/core/conversationMenu.ts`: consulta, revisão e confirmação da retirada; navegação e invalidação por identidade/revisão.
- `src/messaging/core/pickup.ts`: contrato de leitura, validação dos campos e mensagens.
- `tests/whatsapp-pickup.cjs`: cobertura específica da retirada.
- `tests/whatsapp-fulfillment.cjs`: expectativas atualizadas para revisão e confirmação explícita.
- `tests/whatsapp-address.cjs` e `tests/fixtures/whatsapp-region-harness.cjs`: leitor de restaurante simulado para os testes que alternam para retirada.
- Este relatório.

## Consulta e disponibilidade

Reutilização direta de `src/service/user/GetIdStoreService.ts`, sem HTTP ou endpoint novo. O serviço existente não foi alterado. Sua consulta é `SELECT ... FROM restaurants WHERE id = $1`, usando exclusivamente o `restaurantId` recebido do contexto validado do WhatsApp. O resultado também precisa pertencer ao mesmo ID.

A disponibilidade segue a regra já existente em `src/service/order/OrderSalesService.ts`: somente `status === true`. Esse serviço não foi modificado. Registro ausente, status diferente de true ou endereço incompleto bloqueiam a confirmação. Os campos name, street, number, neighborhood e city são obrigatórios; objetos, valores vazios e representações inválidas não são exibidos. O número também aceita valor numérico finito.

A seleção e a confirmação consultam novamente o serviço. Se qualquer campo exibido mudar, o novo endereço é apresentado e exige nova confirmação. Se o restaurante fechar ou for excluído, a confirmação é bloqueada. Após recuperação da disponibilidade ou de erro, o cliente precisa revisar novamente antes de confirmar.

## Sessão e estados

Novos estados: `PICKUP_LOADING`, `PICKUP_REVIEW`, `PICKUP_ERROR`. Reutilizado `FULFILLMENT_SELECTED` para a confirmação concluída; `FULFILLMENT_CHOICE` inicia a consulta ao selecionar 2.

A sessão guarda `fulfillmentMode: PICKUP`, `pickupAddress` (snapshot com restaurantId) e `pickupConfirmed: true` somente após a reconsulta bem-sucedida e sem mudanças. A confirmação permanece ao voltar ao carrinho. Abrir novamente a escolha de modalidade invalida o snapshot e exige novo fluxo; troca de identidade também limpa os dados. A chave de sessão continua incluindo restaurante, sessão/conta/chat e remetente.

O contador de revisão impede que respostas assíncronas tardias confirmem retirada após 0 ou troca de identidade. O carrinho e a identidade do cliente são preservados. A entrada na retirada limpa o rascunho conversacional de entrega e a associação de frete, sem atualizar o cadastro do cliente. Não há consulta a bairros, cálculo de frete, escrita no restaurante, criação de pedido, pagamento ou mudança de schema.

## Validação automatizada

Executados em `BackEnd-lanchonete`:

- `npx tsc --noEmit`: passou.
- `git diff --check`: passou.
- `node tests/whatsapp-pickup.cjs`: 57/57.
- `node tests/whatsapp-fulfillment.cjs`: 15/15.
- `node tests/whatsapp-address.cjs`: 26/26.
- `node tests/whatsapp-delivery-regions.cjs`: 21/21.
- `node tests/whatsapp-neighborhood-selection.cjs`: 21/21.
- `node tests/whatsapp-customer-lookup.cjs`: 24/24.
- `node tests/whatsapp-customer-registration.cjs`: 24/24.
- `node tests/whatsapp-phone-identity.cjs`: 5/5.

Total dessas suítes: 193 testes aprovados. As dependências de persistência são simuladas; nenhum dado real do Neon foi alterado. O teste do serviço existente intercepta `pool.query` e verifica o SELECT parametrizado.

Também executado `node tests/whatsapp-local.cjs`: 12/14. Duas falhas fora da etapa, relacionadas a contratos anteriores do menu inicial: `initialReply is not a function` e expectativa de texto `undefined` em vez do menu atual. Essas funções, mensagens e expectativas não foram alteradas nesta etapa. Não foram executadas suítes PostgreSQL que exigem banco real.

## Roteiro real no WhatsApp

1. Usar um restaurante de teste aberto, com nome, rua, número, bairro e cidade completos, e um cliente de teste com identidade WhatsApp validada.
2. Adicionar produtos simples e configurados, incluindo adicionais e quantidades diferentes. Conferir o carrinho.
3. Finalizar e selecionar 2. Conferir cada campo com o cadastro real do restaurante. Não deve haver pergunta sobre endereço do cliente, bairros ou frete.
4. Selecionar 1. Conferir a mensagem de modalidade confirmada, com a ressalva de que a criação de pedidos estará disponível em etapa futura.
5. Enviar 0. Conferir todos os itens, variantes, adicionais, quantidades e preços do carrinho.
6. Finalizar novamente; escolher entrega, voltar com 0 e escolher retirada novamente. Conferir que os dados e a taxa da entrega não aparecem na retirada.
7. Repetir com outra sessão e outro restaurante de teste, verificando endereços independentes.
8. Em ambiente controlado com cadastros de teste, exibir a retirada e alterar o endereço pelo painel antes de confirmar: o bot deve mostrar os novos dados e exigir mais uma confirmação.
9. Repetir fechando o restaurante pelo painel antes da confirmação: deve bloquear. Reabrir, consultar novamente, revisar e então confirmar.
10. Em ambiente de teste, cobrir cadastro incompleto, registro ausente e falha simulada de leitura. Deve bloquear sem encerrar a sessão e permitir retorno ao carrinho.
11. Verificar que nenhum pedido novo foi criado e que o endereço cadastrado do cliente permanece igual.

O teste real pelo WhatsApp não foi executado nesta implementação.
