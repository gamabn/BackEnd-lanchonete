# Gama Bot — Etapa 8.6B.6.6C

## Fluxo de entrega

O catálogo e a validação da etapa 6.6B são reutilizados. Não há outra tabela,
endpoint ou fonte de frete. bairroService.getBairro continua sendo a consulta de
bairros, com isolamento por lanchonete_id e exclusão de restaurantes órfãos.

Ao escolher DELIVERY, o bot lê o endereço do próprio cliente, sob a verificação de
telefone/restaurante já existente. Isso não solicita dados ao usuário nem grava.

- Se o endereço estiver completo e seu bairro corresponder a exatamente uma região
  válida, mostra o endereço existente para confirmação, conforme a regra específica
  para clientes já cadastrados. Não regrava nem renomeia silenciosamente esse perfil.
- Sem endereço completo, mostra ESCOLHA SEU BAIRRO antes de pedir qualquer campo.
- Se o bairro persistido não for atendido, explica o problema e apresenta a lista.
- Duplicidades e erros bloqueiam confirmação e permitem reconsulta ou outra seleção.

As opções vêm do catálogo do restaurante, com UUID real, nome oficial e frete atual.
A listagem é paginada de dez em dez quando necessário. A relação entre número e UUID
é guardada na conversa; uma resposta não é interpretada pela posição de uma consulta
posterior. Antes de aceitar a opção, resolve novamente o UUID e confere nome, taxa,
restaurante e ausência de nomes equivalentes duplicados no PostgreSQL.

Mudança de nome/preço ou remoção entre exibição e seleção gera uma lista atualizada
e exige nova escolha. A seleção válida é guardada em addressRegion. Ainda não é a
confirmação de entrega/pagamento; deliveryRegion mantém o papel de prévia revalidada
da etapa 6.6B, somente após confirmação do endereço.

Frete zero aparece como GRÁTIS. Outros valores usam formatação em reais, sempre com
a origem no banco. A validação monetária foi compartilhada em security/deliveryFee.ts,
reexportada pelo módulo anterior para preservar os consumidores. Mantém a regra de
NUMERIC(10,2), representação decimal canônica e conversão com BigInt; não calcula ou
persiste um novo frete definitivo.

## Endereço novo e correções

Depois de escolher o bairro, o bot coleta somente:

1. Rua.
2. Número.
3. Cidade.
4. Complemento opcional, com P para omitir.

O rascunho recebe neighborhood diretamente do nome oficial da região escolhida.
Não existe etapa ativa de digitação livre de bairro. O antigo estado
ADDRESS_NEIGHBORHOOD redireciona para a seleção do catálogo.

A revisão apresenta o nome oficial e as opções:

- 1: confirmar e salvar.
- 2: corrigir os dados, mantendo o bairro válido selecionado.
- B: escolher outro bairro pela lista, invalidando a associação anterior.
- 0: cancelar a edição não confirmada e retornar ao carrinho.

B também está disponível durante a coleta. Trocar o bairro descarta o rascunho e
reinicia os quatro campos após a nova seleção. Corrigir outros dados preserva o UUID
e o nome selecionados, desde que continuem válidos na reconsulta. O banco mantém o
endereço anterior até a confirmação e o sucesso da transação.

## Gravação exata e revalidação

O bot exige addressRegion antes de permitir a gravação. Ao receber 1 na revisão:

1. Resolve novamente o UUID pelo catálogo existente, conferindo nome e taxa vistos.
2. Se algo mudou, não grava: volta à seleção atualizada, para nova escolha/coleta.
3. Chama CustomerAddressService.save com o UUID real e a taxa decimal da prévia.
4. A transação existente bloqueia o cliente, verifica restaurante/telefone e relê
   limites do perfil. Agora também usa bairroService na MESMA conexão transacional.
5. Os registros do restaurante são relidos com FOR SHARE e o UUID selecionado precisa
   existir nesse restaurante, com preço válido e igual ao apresentado.
6. A comparação de nomes continua em lower(btrim(...)) no PostgreSQL. Mais de uma
   correspondência bloqueia a atualização, inclusive se introduzida após a seleção.
7. Somente então o serviço valida e atualiza os campos de endereço do cliente.

O número, a rua e demais campos mantêm as validações existentes. Para neighborhood,
a validação autoritativa exige igualdade exata com o nome obtido do catálogo e
respeita o limite real da coluna. Não aplica NFC, trim, alteração de caixa ou redução
de espaços ao nome oficial. Assim, jacarezinho b2 permanece exatamente dessa forma;
nomes oficiais com espaços ou Unicode também são preservados sem truncamento.

UpdateClientService valida novamente usando o nome oficial verificado pelo serviço
transacional. O retorno é comparado com o endereço confirmado: um trigger que altere
o nome de forma incompatível não produz sucesso silencioso. APIs existentes continuam
com o comportamento anterior; o argumento oficial e a referência de região são
internos ao fluxo de endereço, não novos campos do contrato de pedidos.

Uma alteração concorrente do endereço continua sendo detectada pelo snapshot e
provoca conflito/rollback. Falhas normais preservam o endereço anterior. Um COMMIT
incerto por queda de conexão continua sem confirmação falsa: a próxima entrada deve
reler o banco. 0 cancela edições não confirmadas; uma transação já autorizada pelo 1
pode concluir enquanto o usuário retorna ao carrinho, sem restaurar estados atrasados.

Depois da gravação, a etapa 6.6B é retomada: endereço persistido e região são relidos,
a taxa é apresentada como prévia e a confirmação de região exige revalidação. Nenhum
pedido ou pagamento é criado. A criação futura continuará usando bairro_id real e
frete recalculado pelo OrderSalesService, que não foi alterado.

## Estados, segurança e retirada

Novos estados:

- DELIVERY_NEIGHBORHOOD_LOADING: catálogo/seleção em verificação.
- DELIVERY_NEIGHBORHOOD_CHOICE: opções exibidas com seu mapeamento para UUID.
- DELIVERY_NEIGHBORHOOD_ERROR: dados inválidos, duplicidade ou falha de consulta.

São reutilizados ADDRESS_EXISTING, ADDRESS_STREET, ADDRESS_NUMBER, ADDRESS_CITY,
ADDRESS_COMPLEMENT, ADDRESS_REVIEW, ADDRESS_SAVING, ADDRESS_CONFIRMED e os estados
de confirmação/revalidação de região da etapa anterior. Os antigos caminhos de
referência para bairro não atendido redirecionam para a seleção real.

addressRegion pertence à mesma chave restaurante/sessão/conta/chat/remetente e ao
vínculo de cliente/telefone verificado usado pelo endereço. A alteração de identidade,
modalidade, bairro ou nova entrada no checkout invalida as associações transitórias.
IDs de outro restaurante, lanchonete_id NULL, UUIDs inválidos e taxas inválidas não
podem ser selecionados. As mensagens não podem escolher restaurant_id ou frete.

PICKUP preserva o fluxo anterior: sem consultar endereço/bairros, sem taxa e sem
pedido. GetIdStoreService não foi integrado: permanece para a próxima etapa.

O carrinho inteiro e a modalidade são preservados nas navegações, inclusive produtos
configuráveis, opções, quantidades e preços. Logs não recebem nomes de clientes,
endereços, telefones, LIDs ou IDs pessoais. Diagnósticos de catálogo permanecem fixos.

## Limitações

A correspondência segue o backend por restaurante e nome; não é geocodificação nem
comprovação de cobertura da cidade. O perfil continua armazenando neighborhood como
texto; o UUID da escolha fica em memória, não em uma coluna nova.

Nomes oficiais precisam caber no campo de bairro do perfil. O bot bloqueia um nome
incompatível com os limites, em vez de encurtá-lo. CHECKs, tipos ou triggers que impeçam
o round-trip exato podem bloquear a gravação e precisam de avaliação separada.

A trava FOR SHARE impede edição/remoção das linhas lidas durante a gravação. Não é
uma garantia de unicidade global contra novos registros duplicados por escritores
externos: a revalidação posterior também detecta ambiguidades. Não foram criados
índices ou constraints. A taxa continua sendo prévia, sem reserva de preço ou
monitoramento contínuo; mudanças posteriores são verificadas nas próximas interações.

A lista pode mostrar nomes duplicados; selecioná-los será bloqueado se a comparação
SQL encontrar múltiplas correspondências, sem escolher o primeiro ou somar taxas.
Mudanças detectadas durante a coleta podem exigir escolher novamente e recoletar os
quatro campos, preservando sempre o perfil anterior até nova confirmação.

## Arquivos da etapa

Produção:

- src/messaging/core/conversationMenu.ts: seleção antes da coleta e correções.
- src/messaging/core/deliveryRegions.ts: listagem, resolução por UUID e GRÁTIS.
- src/messaging/core/customerAddress.ts: opções de alteração de bairro.
- src/security/deliveryFee.ts: validador decimal compartilhado, novo arquivo.
- src/security/customerAddress.ts: validação exata de bairro oficial.
- src/service/bairro/bairroService.ts: conexão injetável e bloqueio opcional de leitura.
- src/service/clients/CustomerAddressService.ts: revalidação transacional da seleção.
- src/service/clients/UpdateClientService.ts: preservação do nome oficial verificado.

Testes e documentação:

- tests/whatsapp-neighborhood-selection.cjs: 19 cenários obrigatórios e casos associados.
- tests/fixtures/whatsapp-region-harness.cjs: fixture compartilhada, novo arquivo.
- tests/fixtures/whatsapp-address-harness.cjs: catálogo e consultas transacionais simulados.
- tests/whatsapp-address.cjs: coleta sem bairro livre e seleção de catálogo.
- tests/whatsapp-address-postgres.cjs: SQL real com região e nome oficial exato.
- tests/whatsapp-delivery-regions.cjs: regressões adaptadas ao novo fluxo.
- tests/whatsapp-fulfillment.cjs: nova opção de mudança de bairro.
- docs/gama-bot-neighborhood-selection.md: este relatório e roteiro.

Schema, migrations, OrderSalesService, contrato de pedidos, pagamentos, autenticação
e dependências não foram alterados. Não houve operações no Neon pelo agente nesta
etapa; os testes não usam dados reais.

## Verificações executadas

- npx tsc --noEmit: passou.
- node tests/whatsapp-neighborhood-selection.cjs: 21/21.
- node tests/whatsapp-delivery-regions.cjs: 21/21.
- node tests/whatsapp-address.cjs: 26/26.
- node tests/whatsapp-fulfillment.cjs: 15/15.
- node tests/whatsapp-customer-registration.cjs: 24/24.
- node tests/whatsapp-customer-lookup.cjs: 24/24.
- node tests/whatsapp-phone-identity.cjs: 5/5.
- node tests/messaging-validation.cjs: 16/16.
- node tests/customer-access.cjs: 10/10.
- node tests/order-security.cjs: 37/37.
- node tests/whatsapp-address-postgres.cjs: 1/1, SQL real com FOR SHARE, nome oficial
  com espaços/apóstrofo, isolamento e rollback em cluster local descartável.
- node tests/whatsapp-delivery-regions-postgres.cjs: 1/1, comparação SQL real e contrato
  legado de listagem preservado, em cluster PostgreSQL local descartável.
- node tests/data-isolation.cjs: 18/19. O teste de bairros passou. Permanece a falha
  legada do catálogo que espera WHERE restaurant_id, enquanto o SQL usa p.restaurant_id.
- node tests/whatsapp-local.cjs: 12/14, mantendo as duas falhas legadas de initialReply
  e menu inicial; os testes de autenticação, locks, QR e reconexão passaram.

Os testes PostgreSQL usam modo single-user e um cluster criado apenas em /tmp, sem
socket ou credenciais do Neon, destruído ao final. Não cadastram nem alteram dados
reais. A validação real desta etapa no WhatsApp permanece pendente.

## Roteiro real no WhatsApp

1. Iniciar npm run dev:bot com a sessão/restaurante de teste existentes, mantendo a
   autenticação atual. Usar o catálogo administrativo já cadastrado, sem criar outro.
2. De cliente sem endereço completo, adicionar produtos simples e configuráveis,
   finalizar e escolher Entrega. Conferir bairros e taxas atuais, com GRÁTIS para zero.
3. Digitar o número de um bairro. Conferir seu nome e preencher rua, número, cidade e
   complemento. O bot não deve pedir o nome do bairro novamente.
4. Conferir a revisão. Antes de confirmar, verificar que o perfil não foi alterado.
   Escolher 1: o nome salvo em customers.neighborhood deve ser exatamente o oficial.
5. Reentrar com endereço completo e atendido: deve mostrar o endereço para confirmação,
   sem regravação automática. Confirmar e conferir a prévia revalidada de região/taxa.
6. Usar 2 na revisão para corrigir dados mantendo o bairro. Usar B para escolher outro
   bairro, recoletar e revisar. Cancelar com 0: endereço anterior e carrinho intactos.
7. Em ambiente de teste, alterar/remover um bairro ou seu frete antes de confirmar:
   o bot deve bloquear a seleção antiga e pedir nova escolha/confirmação. Duplicidades
   de nomes equivalentes não podem resolver para a primeira linha.
8. Testar região de outro restaurante, registros sem lanchonete_id e frete inválido
   somente em dados de teste. Não devem ser oferecidos como opções válidas.
9. Escolher Retirada: não deve consultar bairros/endereço nem apresentar endereço do
   estabelecimento nesta etapa. Conferir o carrinho e os preços preservados.
10. Conferir isolamento entre contas/sessões/restaurantes e logs sem dados pessoais.
    Nenhum cenário deve criar pedido ou abrir fluxo de pagamento.
