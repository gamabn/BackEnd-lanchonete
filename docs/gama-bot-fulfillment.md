# Gama Bot — Etapa 8.6B.6.4

## Comportamento

Ao escolher 3 no carrinho preenchido, o bot mantém a consulta existente pelo telefone
verificado e pelo restaurant_id da sessão. Uma correspondência única agora avança
para FULFILLMENT_CHOICE, apresentando:

```text
🚚 COMO DESEJA RECEBER SEU PEDIDO?

1 - Entrega
2 - Retirada no estabelecimento

0 - Voltar ao carrinho
```

Cliente não encontrado segue o cadastro inicial existente. Somente após a confirmação
e o sucesso da persistência o bot mostra a conclusão do cadastro e o mesmo menu.
Se um cliente for encontrado durante a confirmação do cadastro, também vai ao menu.
Erros, duplicidades ou telefone não verificado não permitem escolher modalidade.

Não havia nomenclatura de modalidade nos módulos pesquisados do projeto. Foi criado
o tipo FulfillmentMode = "DELIVERY" | "PICKUP", salvo em fulfillmentMode no estado
da conversa, junto de customerId e do carrinho. Nenhuma coluna foi adicionada.

1 grava DELIVERY; 2 grava PICKUP. Ambos avançam a FULFILLMENT_SELECTED e mostram
somente a mensagem solicitada para a modalidade, com 0 para retornar ao carrinho.
Não solicitam endereço, consultam bairros, calculam taxa ou criam pedidos.
Entradas inválidas no menu repetem as opções e não alteram a modalidade anterior.
No estado de confirmação da escolha, outras mensagens repetem a confirmação.

## Navegação e isolamento

0 volta ao carrinho tanto no menu quanto após a escolha, sem alterar nenhum produto,
preço, quantidade, variante ou opção. A modalidade e o customerId permanecem em memória
nessa navegação. Para mudar de modalidade, usar 0, 3 e a nova escolha.
A nova finalização repete a consulta existente para validar o cadastro; se houver
falha, ausência de cliente, ambiguidade ou alteração do cliente retornado, a modalidade
anterior é descartada. Mudança do telefone também descarta modalidade e associação,
exigindo nova identificação antes de apresentar o menu.

A chave de estado continua incluindo restaurante, sessão/conta/chat construídos pelo
processor e remetente original. Nenhuma modalidade é compartilhada entre chaves.
A escolha exige customerId, telefone de origem confiável e carrinho preenchido.
Telefone digitado ou LID sem mapeamento não autoriza esta etapa. Uma resposta de
consulta/cadastro atrasada não força o menu após o cliente voltar com 0.

A modalidade é temporária, como o carrinho: não é persistida entre reinicializações
do worker. Alterações fora do bot no cadastro são detectadas na próxima consulta,
não por monitoramento contínuo. Nenhum mecanismo de autenticação foi alterado.
Baileys permanece em 6.7.23.

## Arquivos desta etapa

- src/messaging/core/fulfillment.ts: tipo e mensagens da modalidade.
- src/messaging/core/conversationMenu.ts: transições após consulta/cadastro,
  escolha, confirmação, retorno e invalidação da modalidade.
- tests/whatsapp-fulfillment.cjs: cenários da etapa.
- tests/whatsapp-customer-registration.cjs, tests/whatsapp-customer-lookup.cjs e
  tests/whatsapp-phone-identity.cjs: expectativas ajustadas ao avanço para modalidade.
- docs/gama-bot-fulfillment.md: comportamento e roteiro.

Os serviços de cliente, carrinho, preços, produtos, conexão, banco e autenticação
não foram modificados nesta etapa. Não há criação de pedidos, pagamento ou checkout
completo. O cadastro inicial anterior continua sendo a única gravação de cliente,
e somente quando necessário e confirmado.

## Verificação

- npx tsc --noEmit: passou.
- node tests/whatsapp-fulfillment.cjs: 15/15.
- node tests/whatsapp-customer-registration.cjs: 24/24.
- node tests/whatsapp-customer-lookup.cjs: 24/24.
- node tests/whatsapp-phone-identity.cjs: 5/5.
- node tests/customer-access.cjs: 10/10.
- node tests/messaging-validation.cjs: 16/16.
- node tests/whatsapp-local.cjs: 12/14, mantendo duas falhas legadas relativas a
  initialReply/menu inicial. Autenticação, lock, QR, reconexão e encerramento simulados
  continuam passando.

Os testes usam leitores e gravadores simulados. Conferem as mensagens, estados,
preservação do carrinho completo, cliente novo/existente, escolhas inválidas,
troca de identidade, isolamento, ausência de PII e respostas atrasadas.
Não confirmam funcionamento real no WhatsApp nesta execução. Nenhuma consulta ou
alteração foi executada no Neon pelo agente nesta etapa.

## Roteiro no WhatsApp real

1. Iniciar npm run dev:bot no terminal já configurado com restaurante, sessão e
   autenticação existentes.
2. De cliente já cadastrado, adicionar um produto simples e outro configurado,
   com variantes, opções e quantidades. Escolher 3: deve aparecer o menu de modalidade.
3. Enviar opção inválida: deve repetir o menu. Enviar 1: deve confirmar ENTREGA,
   sem pedir endereço ou calcular taxa.
4. Enviar 0 e verificar o carrinho integral. Enviar 3 e depois 2: deve confirmar
   RETIRADA NO ESTABELECIMENTO, sem exigir endereço ou criar pedido.
5. Voltar com 0 e repetir a finalização. O menu deve permitir escolher novamente;
   a preferência anterior pode permanecer no estado, mas só a nova escolha confirma.
6. De cliente novo, concluir o cadastro inicial: deve aparecer a mensagem de sucesso
   seguida do menu de modalidade, sem perder o carrinho e sem precisar cadastrar de novo.
7. Conferir que outra conta/sessão/restaurante não herda a modalidade. Quando houver
   apenas LID não resolvido, não deve ser possível pular a identificação com números
   digitados manualmente.
8. Conferir que os logs não mostram telefone, LID, nome ou dados de outros cadastros.
