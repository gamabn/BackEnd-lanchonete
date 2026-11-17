# Gama Bot — Etapa 8.6B.6.5

## Fluxo

Apenas DELIVERY inicia a consulta do endereço. O serviço confere novamente o vínculo
entre customer_id, restaurant_id e telefone verificado, na mesma transação que lê o
endereço. Só então a conversa pode exibir os dados desse cliente.

Endereço completo exige rua, número, bairro e cidade válidos; complemento é opcional.
O bot apresenta o endereço cadastrado, com opções 1 confirmar, 2 alterar e 0 voltar.
1 refaz a leitura, verifica que o endereço continua igual e registra addressConfirmed
com confirmedAddress em memória. Não executa UPDATE. Se os dados mudaram, apresenta o
endereço atual e exige nova confirmação.

Sem endereço completo (inclusive cadastro parcial), coleta todos os campos, um por
mensagem: rua, número, bairro, cidade e complemento. Não aproveita silenciosamente
campos de um endereço parcial. O complemento pode ser omitido com P. A prévia mostra
“Não informado” quando ausente; esse texto não é salvo como complemento.

Na prévia, 1 confirma e salva; 2 descarta o rascunho e reinicia a coleta para correção;
0 cancela a edição não confirmada, limpa o rascunho e retorna ao carrinho. PICKUP não
consulta nem solicita endereço e não atualiza customers.

O carrinho inteiro, customerId e modalidade são preservados ao retornar com 0.
A confirmação e o rascunho de endereço são descartados nessa navegação. Ao finalizar
novamente e escolher entrega, o endereço é lido do banco e requer nova confirmação.
Nenhuma operação de taxa, pagamento ou criação de pedido é executada.

## Inspeção e compatibilidade

Foram inspecionados ConversationMenu, GetClientService, UpdateClientService,
customerAccess, a fixture de schema, bairroService, OrderSalesService, orderValidation
e os testes existentes. A fixture local define os cinco campos de endereço como
TEXT e a FK customers.restaurant_id -> restaurants.id. A informação fornecida pelo
usuário confirma NULL permitido em street, number e neighborhood no banco atual.

A tentativa de consultar somente os metadados do Neon não conseguiu conectar.
Portanto, tipos, limites, CHECKs e triggers reais do Neon não foram confirmados nesta
execução. Nenhum dado real de cliente foi consultado ou alterado pelo agente.
O arquivo ops/customer-address-check.sql permite conferir somente os metadados no
Neon SQL Editor, sem consultar registros ou alterar o banco.

O bot lê information_schema.columns em tempo de execução antes da coleta e novamente
na gravação. Limites menores do banco sempre prevalecem. Além deles, aplica limites
operacionais para manter mensagens legíveis no WhatsApp:

| Campo | Limite operacional, quando o banco não exige menor |
| --- | --- |
| Rua | 200 caracteres |
| Número textual | 32 caracteres |
| Bairro | 120 caracteres |
| Cidade | 120 caracteres |
| Complemento | 200 caracteres |

São aceitos text, character varying e character. Número também admite smallint,
integer e bigint: exige dígitos positivos dentro do intervalo real do tipo e normaliza
zeros à esquerda. S/N e 12A só são permitidos quando a coluna é textual. Outros tipos,
colunas ausentes ou geradas não são presumidos compatíveis: a operação é bloqueada.
CHECKs e triggers customizados continuam sendo garantidos pelo PostgreSQL. Erros de
restrição fazem rollback e nunca resultam em mensagem de endereço salvo.

O validador normaliza NFC e espaços, rejeita caracteres de controle, campos obrigatórios
vazios, comandos de menu e excesso de caracteres. Rua, bairro e cidade precisam ter
letras; número respeita o tipo e formato do campo. O número 1 ou 2 é dado quando o
bot está perguntando o número do imóvel; 0 permanece reservado para voltar ao carrinho.
Não há validação geográfica, CEP ou comprovação física do endereço nesta etapa.
Complemento ausente é NULL quando permitido; se a coluna for NOT NULL, utiliza string
vazia como ausência de conteúdo. Não inventa endereço nem grava “Não informado”.
Restrições adicionais que proíbam essa ausência podem impedir a gravação e precisam
ser revistas em uma etapa autorizada; não foram criadas migrações.

## Atualização segura

CustomerAddressService usa uma conexão transacional em READ COMMITTED, com limite de
espera de lock de 5s e statement_timeout de 10s. A leitura usa FOR SHARE e a gravação
FOR UPDATE, sempre no par customer_id/restaurant_id. Após bloquear a linha, reutiliza
GetClientService.findByWhatsAppPhone para conferir uma única correspondência segura
com o telefone, incluindo a compatibilidade brasileira existente. Não libera dados
nem atualiza um cliente diferente ou um telefone ambíguo.

GetClientService ganhou uma leitura específica dos cinco campos, sem trazer nome,
e-mail ou telefone. UpdateClientService ganhou updateAddress, que valida novamente
com os limites atuais e atualiza exclusivamente city, street, number, neighborhood
e complement. O método execute da API existente mantém seu comportamento.

A gravação compara o endereço atual com a cópia obtida antes da edição. Se outro
processo alterou o endereço, retorna conflito, sem sobrescrever a edição externa.
Se o mesmo endereço já estiver salvo, retorna sucesso sem executar outro UPDATE.
Confirmações repetidas ficam nos estados de operação/conclusão e não duplicam escrita.
O retorno do UPDATE é conferido contra o endereço confirmado; alterações inesperadas
no conteúdo por trigger não são aceitas silenciosamente.

Toda falha normal de persistência causa rollback. Se o rollback falhar, a conexão é
descartada. A confirmação só aparece depois de COMMIT bem-sucedido. Uma queda de rede
que torne o COMMIT incerto não permite garantir se o servidor gravou: o bot não exibe
sucesso nem repete automaticamente a escrita; nova entrada deve reler o banco.

0 cancela edições ainda não confirmadas. Depois do 1, uma transação já autorizada pode
concluir mesmo que o cliente volte ao carrinho enquanto aguarda. A resposta atrasada
não altera o estado atual nem revela o endereço depois da navegação.

A chave da conversa continua incluindo restaurante, sessão/conta/chat e remetente.
O rascunho também fica vinculado ao customerId e telefone verificado daquela conversa.
Mudança de identidade o invalida. Telefone digitado ou LID não resolvido não autoriza
consulta ou atualização. Logs novos não mostram endereço, nome, telefone, LID ou erros
SQL. Dados de endereço aparecem somente na conversa autorizada, como solicitado.

## Estados

- ADDRESS_LOADING: consulta/verificação em andamento.
- ADDRESS_EXISTING: endereço cadastrado aguardando confirmação ou alteração.
- ADDRESS_STREET, ADDRESS_NUMBER, ADDRESS_NEIGHBORHOOD, ADDRESS_CITY e
  ADDRESS_COMPLEMENT: coleta sequencial.
- ADDRESS_REVIEW: prévia aguardando confirmação explícita ou correção.
- ADDRESS_SAVING: persistência confirmada em andamento.
- ADDRESS_CONFIRMED: confirmação registrada, com distinção entre existente e salvo.
- ADDRESS_ERROR: erro, conflito, vínculo inválido ou schema incompatível.

## Bairros, taxas e OrderSalesService

bairroService trabalha com bairros(id, bairro, frete, lanchonete_id). A fixture declara
lanchonete_id como FK de restaurants. customers.neighborhood é somente texto, sem
associação persistida a um bairro_id. Um nome digitado não prova atendimento nem
identifica uma região única; podem existir nomes repetidos ou cidades diferentes.

OrderSalesService exige bairro_id no input. Ele valida o cliente pelo restaurante,
confere bairros.id e lanchonete_id e exige igualdade textual após lower/btrim entre
bairros.bairro e customers.neighborhood. Também lê o frete atual e persiste um snapshot
do endereço em orders.delivery_address. Esse serviço NÃO foi modificado nem chamado.
Os testes existentes confirmam que atualizações do perfil não mudam snapshots de
pedidos anteriores.

Na próxima etapa, a seleção deverá utilizar registros reais de bairros do restaurante,
com ID e confirmação de uma região atendida, além de tratar duplicidades e compatibilidade
com cidade/endereço. Não usar aproximação, sufixos ou nomes sozinhos como autorização.
Se o texto coletado não corresponder a um bairro atendido, será necessário solicitar
uma seleção/correção explícita; não criar bairros ou atribuir IDs automaticamente.
Também será preciso revalidar o endereço confirmado e a taxa no momento de criar pedido.

PICKUP permanece apenas no estado do bot. O OrderSalesService atual exige bairro e
calcula entrega: integrá-lo a retirada demandará trabalho futuro autorizado. Salvar ou
confirmar um endereço nesta etapa não conclui essa integração nem cria um pedido.

## Arquivos

Criados: security/customerAddress.ts, service/clients/customerAddressSchema.ts,
service/clients/CustomerAddressService.ts, messaging/core/customerAddress.ts,
tests/whatsapp-address.cjs, tests/whatsapp-address-postgres.cjs,
tests/fixtures/whatsapp-address-harness.cjs, ops/customer-address-check.sql e este documento.
Os caminhos de código são relativos a src/.

Modificados: src/messaging/core/conversationMenu.ts,
src/service/clients/GetClientService.ts, src/service/clients/UpdateClientService.ts,
tests/whatsapp-fulfillment.cjs, tests/whatsapp-customer-registration.cjs e
tests/customer-access.cjs. As alterações nos testes anteriores ajustam a nova etapa
após DELIVERY e fornecem dependências simuladas, evitando acesso ao Neon.

Não foram modificados autenticação, Baileys, carrinho, produtos, preços,
OrderSalesService ou estrutura de banco. Nenhuma dependência foi instalada.

## Verificação

- npx tsc --noEmit: passou.
- node tests/whatsapp-address.cjs: 26/26.
- node tests/whatsapp-address-postgres.cjs: 1/1, SQL real em cluster PostgreSQL local
  descartável, sem sockets ou conexão ao Neon. Verifica escopo, limites VARCHAR e rollback.
- node tests/whatsapp-fulfillment.cjs: 15/15.
- node tests/whatsapp-customer-registration.cjs: 24/24.
- node tests/whatsapp-customer-lookup.cjs: 24/24.
- node tests/whatsapp-phone-identity.cjs: 5/5.
- node tests/customer-access.cjs: 10/10.
- node tests/messaging-validation.cjs: 16/16.
- node tests/order-security.cjs: 37/37.
- node tests/order-delivery-address.cjs: 1/1, snapshots reais em PostgreSQL local.
- node tests/whatsapp-local.cjs: 12/14; mesmas falhas legadas de initialReply/menu inicial.
  Autenticação, locks, QR, reconexão e encerramento simulados passaram.

Os 16 cenários solicitados estão cobertos, incluindo endereço completo/parcial,
coleta, validação, limites, correção, confirmação, cancelamento, falhas, isolamento,
retirada, preservação do carrinho, mensagens repetidas e reentrada. Os testes não
modificam dados do Neon e não confirmam WhatsApp real. Mensagens repetidas com o mesmo
ID continuam sendo deduplicadas pelo processor existente; textos iguais com IDs novos
são entradas novas, porque bairro e cidade podem legitimamente ter o mesmo nome.

## Roteiro no WhatsApp real

1. Opcionalmente executar ops/customer-address-check.sql no Neon SQL Editor para
   revisar tipos, limites, restrições e triggers reais. O arquivo é somente de leitura.
2. Iniciar npm run dev:bot com a configuração e autenticação existentes do restaurante
   de teste. Usar um cliente autorizado com endereço completo, adicionar produtos
   simples e configuráveis com quantidades/opções, finalizar e escolher entrega.
3. Conferir que só o endereço desse cadastro aparece. Confirmar com 1: deve informar
   endereço confirmado, sem alteração no banco. Repetir 1 não deve regravar.
4. Voltar com 0, conferir carrinho e modalidade, finalizar e escolher retirada.
   Não deve consultar, solicitar ou modificar endereço.
5. Com cliente sem endereço ou incompleto, escolher entrega e preencher rua, número,
   bairro, cidade e complemento. Testar campos vazios, comandos e limite informado.
   Usar P para omitir complemento. Até a prévia, o banco deve permanecer inalterado.
6. Na prévia, escolher 2 e corrigir os campos. Escolher 0 antes de confirmar: o rascunho
   deve desaparecer sem gravação, com carrinho preservado. Recomeçar e confirmar com 1:
   deve salvar somente o endereço e apresentar a mensagem de sucesso.
7. Repetir confirmações; não deve duplicar UPDATE. Voltar ao carrinho, finalizar e
   escolher entrega novamente: deve carregar o endereço salvo e pedir confirmação.
8. Em ambiente de teste, alterar o endereço por outro fluxo entre leitura e gravação:
   a confirmação do rascunho antigo deve falhar por conflito, sem sobrescrever o novo.
   Testar falha de banco: não deve apresentar sucesso nem perder carrinho.
9. Repetir com outras contas, sessões e restaurantes. Telefone manual, LID não resolvido
   ou customerId que não pertença ao restaurante/telefone não pode liberar endereço.
10. Conferir logs sem dados pessoais.

Nenhum teste real no WhatsApp foi executado pelo agente nesta etapa.
