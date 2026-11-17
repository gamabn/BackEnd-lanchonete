# Gama Bot — Etapa 8.6B.6.6B

## Escopo e fonte única

A implementação reutiliza bairroService.getBairro(lanchonete_id), em
src/service/bairro/bairroService.ts. Não cria tabela, endpoint, consulta paralela,
região ou cálculo definitivo de frete. O schema real informado pelo usuário é
public.bairros(id UUID NOT NULL, bairro VARCHAR NOT NULL, frete NUMERIC(10,2) NOT NULL,
criado_em TIMESTAMP nullable, lanchonete_id UUID nullable).

getBairro recebeu um segundo argumento opcional, neighborhood. Sem ele, a consulta
continua retornando somente id, bairro, frete e lanchonete_id, preservando os
controllers existentes. Quando usado pelo bot, a mesma consulta acrescenta:

```sql
lower(btrim(bairro)) = lower(btrim($2::text)) AS matches_address
```

O WHERE existente continua filtrando lanchonete_id = $1 e exigindo a existência do
restaurante. O primeiro argumento vem exclusivamente do contexto da sessão, nunca
do corpo da mensagem. O adaptador também descarta registros retornados com outra
lanchonete_id ou NULL. Não atribui disponibilidade a registros órfãos.

A comparação é executada pelo PostgreSQL, com a mesma regra e collation do backend.
Não usa lower/trim de JavaScript para decidir o atendimento. O argumento é o bairro
persistido em customers, relido pelo serviço de endereço que verifica cliente,
restaurante e telefone. Não utiliza o texto normalizado apenas para exibição.
Não remove acentos, espaços internos, abreviações ou altera nomes para obter casamento.

## Fluxo

Depois de confirmar um endereço existente ou salvar um endereço novo, o bot consulta
novamente o endereço e verifica o snapshot confirmado. Se mudou externamente, descarta
a seleção de região e pede nova confirmação do endereço atual. Não prossegue com a
confirmação anterior. Só então consulta o catálogo existente de bairros.

Com exatamente uma correspondência válida, apresenta nome e taxa, com 1 para confirmar,
C para corrigir o endereço e 0 para voltar ao carrinho. A confirmação executa nova
consulta do endereço e do catálogo. Se ID, nome ou taxa mudou, mostra uma prévia nova
e exige outro 1; não confirma silenciosamente o valor anterior.

Com nenhuma correspondência, apresenta as regiões válidas do restaurante e seus
fretes. A lista é paginada em blocos de dez, usando N/A para navegar. A associação
entre opção numérica e UUID exibido fica na conversa. Não reconstrói a escolha pela
posição de uma nova listagem. Ao selecionar, reconsulta e procura o ID exibido;
região removida é descartada e a lista é atualizada.

Essa seleção é somente uma referência para corrigir o endereço: regionHint é distinto
de deliveryRegion. Não concede atendimento, não confirma frete nem modifica customers.
O cliente escolhe 1 para corrigir e usa o fluxo de endereço existente, um campo por
vez e com confirmação explícita antes de salvar. O nome da região aparece como
referência, sem preencher automaticamente customers.neighborhood. Depois de salvar,
o catálogo é consultado novamente e a correspondência é reavaliada.

C permite corrigir diretamente, sem selecionar referência. Iniciar a correção
invalida a seleção de região. Cancelar com 0 não altera o endereço persistido nem os
itens do carrinho; uma nova finalização revalida o fluxo. Endereço e seleção ficam
pendentes de nova confirmação quando a edição é cancelada.

Com múltiplos nomes equivalentes, não escolhe o primeiro nem supõe taxas iguais.
Também conta duplicidades com taxas inválidas antes de validar os preços. Bloqueia
confirmação e oferece reconsulta/correção. O diagnóstico contém somente
[bot:delivery_region] motivo=AMBIGUOUS, sem nomes, IDs, telefone, LID ou endereço.
Falhas e dados inválidos usam os motivos fixos ERROR e INVALID.

## Frete e estado

O adaptador ExistingRegionCatalog, em messaging/core/deliveryRegions.ts, somente
valida e apresenta os dados consultados. Aceita valores decimais não negativos com
até duas casas e oito dígitos inteiros, conforme NUMERIC(10,2). Aceita zero e rejeita
NULL, negativos, NaN, Infinity, booleanos, moeda/vírgula formatada, precisão excessiva
e valores fora do intervalo. Não arredonda nem converte dados inválidos em zero.
Reutiliza moneyCents/moneyText para representação inteira em centavos com BigInt.
A formatação em reais também usa strings; não soma taxas de múltiplas regiões.

O bot não lê frete de mensagens do WhatsApp. UUIDs inválidos, nomes vazios, caracteres
de controle, nomes acima de 200 caracteres ou IDs duplicados são recusados para
seleção segura. Regiões sem dados válidos não são oferecidas como alternativa.

O estado deliveryRegion contém:

- bairro_id: UUID real retornado do cadastro;
- bairro e fee: nome e valor decimal canônico da prévia;
- restaurant_id, customer_id e fulfillment_mode: vínculo com o contexto e DELIVERY;
- address: snapshot persistido que foi confirmado;
- confirmed: false na prévia, true somente após revalidação e confirmação explícita.

A conversa continua isolada pela chave de restaurante, sessão/conta/chat e remetente.
Carrinho completo, quantidades, preços, variantes e opções não são modificados.
Consultar regiões preserva addressConfirmed/confirmedAddress e o cliente identificado,
inclusive quando houver falha no catálogo. Erros de vínculo ou mudança de endereço
invalidam a confirmação e exigem novo fluxo de endereço.

0 nos estados de região retorna ao carrinho preservando endereço confirmado e a
associação de região disponível no momento. A próxima finalização limpa os dados
transitórios e refaz a consulta de cliente, endereço e região. Alterar o telefone,
iniciar correção ou selecionar PICKUP descarta a associação anterior.

PICKUP não chama o catálogo de bairros, não solicita endereço e não calcula taxa.
Não envia bairro fictício para o backend. O OrderSalesService e seu contrato continuam
inalterados, inclusive a ausência atual de suporte a retirada na criação de pedidos.

## Estados adicionados

- DELIVERY_REGION_LOADING: revalidação em andamento.
- DELIVERY_REGION_AVAILABLE: prévia de uma correspondência segura.
- DELIVERY_REGION_NOT_FOUND: lista de referências para correção.
- DELIVERY_REGION_GUIDANCE: referência escolhida, ainda sem autorização de entrega.
- DELIVERY_REGION_AMBIGUOUS: mais de uma correspondência, confirmação bloqueada.
- DELIVERY_REGION_INVALID: dados de região/frete inválidos.
- DELIVERY_REGION_ERROR: falha de consulta.
- DELIVERY_REGION_CONFIRMED: confirmação explícita da prévia revalidada.

As respostas atrasadas não restauram seleção após 0 ou mudança de identidade.
Mensagens concorrentes durante a consulta recebem aviso de operação em andamento.
Nenhum desses estados avança para pagamento ou cria pedido. Mesmo a região confirmada
continua sendo uma prévia: o backend deverá verificar novamente os dados e o preço
atual na futura criação do pedido. Não há monitoramento contínuo ou reserva de preço;
mudanças externas são detectadas na confirmação, reconsulta, interação no estado
confirmado ou reentrada no checkout.

## Limitações

A autorização desta etapa segue o nome do bairro e o restaurante, como o backend.
Não comprova cobertura geográfica da cidade. Não elimina ambiguidades do catálogo:
essas situações precisam de correção explícita do cadastro administrativo ou endereço.
A normalização de endereço existente aplica NFC/espaços, enquanto a comparação do
backend usa lower/btrim. Nomes cadastrados com grafia incompatível, Unicode diferente
ou espaços internos podem impedir correspondência; não são reparados silenciosamente.
Os limites do campo de bairro do perfil também continuam valendo durante a correção.

As listagens são snapshots. Paginação não reconsulta para evitar mudar os IDs exibidos;
a seleção de referência e a confirmação revalidam os dados. Uma alteração após a última
consulta ainda pode ocorrer; por isso a taxa não é definitiva. Não houve consulta nem
alteração de dados reais no Neon nesta implementação ou nos testes automatizados.
A validação desta etapa em WhatsApp real permanece pendente.

## Arquivos desta etapa

Produção:

- src/service/bairro/bairroService.ts: tipagem do retorno e projeção opcional de comparação.
- src/messaging/core/deliveryRegions.ts: adaptador do serviço existente, validação e mensagens.
- src/messaging/core/conversationMenu.ts: transições, confirmação e correção integrada.

Testes:

- tests/whatsapp-delivery-regions.cjs: casos de integração e segurança da etapa.
- tests/whatsapp-delivery-regions-postgres.cjs: SQL real em PostgreSQL descartável.
- tests/fixtures/whatsapp-address-harness.cjs: catálogo simulado para regressões.
- tests/whatsapp-address.cjs: expectativas após confirmação agora incluem regiões.
- tests/whatsapp-fulfillment.cjs e tests/whatsapp-customer-registration.cjs:
  injeção de catálogo simulado, impedindo acesso ao banco real nos testes.
- docs/gama-bot-delivery-regions.md: este relatório e roteiro.

Não foram alterados schema, migrations, OrderSalesService, contrato de criação de
pedidos, pagamento, autenticação ou dependências. A única escrita de endereço é a já
existente, executada somente após confirmação explícita da correção.

## Testes executados

- npx tsc --noEmit: passou.
- node tests/whatsapp-delivery-regions.cjs: 21/21.
- node tests/whatsapp-delivery-regions-postgres.cjs: 1/1. PostgreSQL local real em modo
  single-user, cluster descartável e sem sockets/credenciais do Neon. Verifica API
  antiga, lower/btrim, acentos, espaços internos, duplicidades, isolamento e frete zero.
- node tests/whatsapp-address.cjs: 26/26.
- node tests/whatsapp-fulfillment.cjs: 15/15.
- node tests/whatsapp-customer-registration.cjs: 24/24.
- node tests/whatsapp-customer-lookup.cjs: 24/24.
- node tests/whatsapp-phone-identity.cjs: 5/5.
- node tests/messaging-validation.cjs: 16/16.
- node tests/customer-access.cjs: 10/10.
- node tests/order-security.cjs: 37/37.
- node tests/data-isolation.cjs: 18/19. O caso de bairros passou. A falha está na
  expectativa do teste de catálogo por WHERE restaurant_id = $1, enquanto o SQL
  existente usa WHERE p.restaurant_id = $1. GetProductIdService não foi alterado.
- node tests/whatsapp-local.cjs: 12/14, mantendo as duas falhas legadas de
  initialReply/menu inicial. Autenticação, locks, QR, reconexão e encerramento passaram.

Os 16 cenários obrigatórios estão cobertos. A integração usa banco/catálogo simulados;
o teste SQL usa apenas dados sintéticos em um cluster local novo, destruído ao final.
Nenhum teste automatizado cadastra clientes, altera bairros ou cria pedidos no Neon.

## Roteiro real no WhatsApp

1. Iniciar npm run dev:bot com restaurante, sessão e autenticação existentes.
2. De cliente com endereço completo cujo bairro seja atendido, adicionar produtos
   simples/configuráveis e finalizar com DELIVERY. Confirmar o endereço: deve mostrar
   o nome e a taxa cadastrada no restaurante. Nada deve ser gravado só por essa consulta.
3. Enviar 1 para confirmar a região: deve indicar confirmação e que a taxa é prévia.
   Não deve abrir pagamento ou criar pedido. Voltar com 0 e conferir carrinho e modo.
4. Em ambiente de teste, alterar a taxa pelo cadastro administrativo existente entre
   prévia e confirmação: o bot deve mostrar a taxa atual e exigir novo 1. Remover uma
   região de teste deve invalidar a seleção. Não alterar registros de produção para
   forçar esses cenários.
5. Com bairro não atendido, conferir a lista do próprio restaurante e os fretes.
   Selecionar uma referência não deve modificar customers.neighborhood. Usar 1 para
   corrigir, preencher os campos e conferir a prévia antes de confirmar a gravação.
6. Cancelar a correção com 0: endereço persistido e carrinho devem permanecer intactos.
   Repetir, salvar explicitamente e conferir nova consulta da região correspondente.
7. Em catálogo de teste com nomes equivalentes duplicados, nenhuma linha deve ser
   selecionada automaticamente, mesmo com taxas iguais. Conferir diagnóstico fixo
   sem nome, telefone, endereço ou ID. R deve reconsultar após resolução administrativa.
8. Testar frete zero e falha de banco em ambiente de teste. Zero deve ser aceito; erro
   não pode ser apresentado como gratuidade ou liberar confirmação.
9. Escolher PICKUP após voltar ao carrinho: não deve solicitar endereço nem consultar
   bairros, mantendo carrinho. Repetir em outra conta/sessão/restaurante e conferir
   que não herda ID, taxa ou seleção da primeira conversa.
10. Conferir que logs não mostram dados pessoais e que nenhuma etapa cria pedidos.
