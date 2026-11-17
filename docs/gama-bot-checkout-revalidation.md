# Etapa H.3 — revalidação e comparação da revisão

`validateOrderCheckout(client, request)` concentra as consultas e regras antes
embutidas em OrderSalesService: restaurante aberto, cliente do restaurante,
região compatível, produtos publicados/disponíveis, configurações, preços,
subtotal, frete, total e suficiência do valor para troco. Usa exclusivamente
o client recebido e SELECTs com FOR SHARE; não abre conexão ou transação,
nem persiste pedidos. O serviço HTTP existente reutiliza essa mesma função.
A validação configurável continua em ValidateAndPriceConfiguredProductService.

`captureCheckoutReview(context, state)` captura dados do estado ORDER_REVIEW
validado pela H.1, incluindo itens, IDs, quantidades, nomes exibidos, preços,
modalidade, endereço, frete, total, pagamento e troco. O token é opaco, local
ao processo e não serializável. A cópia interna não compartilha referências
com carrinho, endereço e opções mutáveis.

Na integração futura, capturar ao apresentar a revisão e guardar o token na
sessão. A confirmação deve usar esse mesmo token, nunca reconstruí-lo a partir
do estado ou de preços recém-consultados. Alterações locais devem descartá-lo.
O contexto de restaurante/sessão também é comparado com o contexto capturado.
O token não autoriza cliente ou sessão: essa responsabilidade continua na H.2.
A captura/revalidação não foi ligada ao menu nesta etapa e a confirmação segue
simulada, sem alteração de comportamento.

`revalidateCheckoutReview(client, context, adaptedCheckout, snapshot)` compara os dados
atuais do banco com essa revisão. Os preços do bot servem somente como valores
esperados para comparação; todos os valores atuais vêm da função compartilhada.
A comparação inclui preço por linha mesmo quando o total agregado permanece
igual, nomes de produtos/variantes, IDs de configuração, endereço completo,
frete e total. Ordem dos IDs das opções não altera seu significado.
Validações de configuração continuam verificando disponibilidade, vínculo e
limites de grupo. O carrinho atual não contém nomes/preços individuais dos
adicionais; a comparação representa os campos da revisão atual, enquanto o
backend revalida a seleção e recalcula o preço agregado da linha.

Resultados:
- `unchanged`: dados atuais e resultado validado, utilizáveis somente no escopo
  transacional corrente.
- `review_required`: motivos tipados e, se os dados atuais forem válidos, uma
  prévia atualizada para preparar outra revisão. Não contém resultado liberado
  para persistência. Produto/configuração/endereço inválido ou troco insuficiente
  também impede continuidade, sem aceitar silenciosamente novo valor.
- Falhas de infraestrutura/serialização são lançadas para abortar a transação.

## Integração transacional futura

Dentro de `withAuthorizedTransaction()` da H.2, executar a revalidação com o
client recebido. Persistir somente se o resultado for `unchanged`, usando os
mesmos dados validados e a mesma conexão, antes de COMMIT. Isso mantém os locks
até o fim. O escopo SERIALIZABLE trata também mudanças estruturais concorrentes.
Não abrir outra conexão e não chamar o execute atual dentro do callback: ele
abre sua própria transação. A persistência precisará aceitar o client e o
resultado validado quando essa integração for autorizada.

Em `review_required`, não persistir. Apresentar uma revisão nova e exigir uma
nova confirmação/autorização, sem promover automaticamente a prévia ao papel
de snapshot confirmado. Nenhum resultado deve ser reaproveitado depois que a
transação encerrar. Não emitir eventos antes de commit.

Os testes usam PostgreSQL simulado, sem acesso ao Neon. Locks e SQL são
verificados, mas a concorrência real e as falhas de serialização ainda devem
ser exercitadas em PostgreSQL descartável. Idempotência e submissão real não
fazem parte desta etapa.
