# Etapa H.2 — autorização interna WhatsApp

`WhatsAppCheckoutAuthorizer.authorize(readCurrentSession)` reutiliza
`identifyCustomer()` e `GetClientService.findByWhatsAppPhone()`. A função exige
um getter do estado vivo da sessão, contexto interno, conta e remetente do
transporte, telefone atual do transporte e checkout válido da H.1.
Não recebe texto de WhatsApp nem credencial HTTP.

O telefone do transporte deve coincidir com o telefone identificado no checkout.
Um remetente com JID de telefone também deve coincidir com esse telefone; LIDs
permanecem opacos. Aplicam-se as regras existentes de número internacional,
exceção brasileira e rejeição de ambiguidades. Restaurante e cliente resultantes
vêm do contexto e do checkout, e o cadastro deve corresponder a ambos.

A autorização é uma capacidade opaca, congelada, local ao authorizer/processo.
Ela é vinculada a restaurante, sessão, conta, remetente, geração de identidade,
telefone, snapshot e conteúdo adaptado do checkout. Não é JWT, não pode ser
serializada/restaurada e não substitui a autenticação HTTP existente.

## Contrato de integração futura

- O getter deve consultar a sessão original por sua chave completa; não deve
  capturar uma cópia congelada da sessão.
- `identityRevision` deve ser uma geração monotônica mantida pelo dono da sessão.
  Deve avançar em toda alteração de identidade, inclusive telefone A -> B -> A.
  A revisão já incrementada pelo menu nas mudanças de telefone pode alimentar
  esse campo; alterações de conta/remetente ou substituição da sessão também
  devem invalidar a capacidade. `invalidate()` permite revogação explícita.
- `withAuthorizedTransaction(token, action)` é o único escopo para usar a
  autorização em persistência futura. Ele abre uma conexão e uma transação
  SERIALIZABLE, repete a identificação na mesma conexão com `FOR SHARE`,
  verifica novamente a sessão antes da ação e antes de enviar COMMIT.
- A ação recebe o mesmo client e os dados adaptados para a sessão autorizada.
  Toda escrita futura precisa usar esse client. Não chamar o atual
  `OrderSalesService.execute()` dentro da ação: ele abriria outra conexão.
  A integração futura precisará expor a operação de pedidos na transação
  fornecida, preservando também as validações comerciais existentes.
- FOR SHARE mantém o cadastro identificado estável até o fim da transação.
  SERIALIZABLE oferece ordenação serial para a verificação de ambiguidades,
  inclusive diante de cadastros concorrentes; falhas de serialização exigem
  nova autorização e repetição da transação inteira.
- Mudanças observadas na sessão revogam o token. Uso concorrente do mesmo token
  é recusado; qualquer tentativa transacional consome o token. Falhas tentam
  rollback e sempre liberam a conexão; falha de rollback descarta a conexão.

Não há uma autorização prévia reutilizável como prova suficiente para gravar
mais tarde: a validação decisiva ocorre no escopo transacional da escrita.
Uma mudança de sessão depois do envio de COMMIT não pode desfazer o commit.
Uma falha de rede durante COMMIT pode ter resultado incerto; rollback não é
prova de ausência de persistência. Essa recuperação depende da futura
idempotência durável, ainda não implementada. Tokens distintos também não
substituem idempotência por checkout.

## Limites desta etapa

O módulo não foi conectado ao menu nem à confirmação simulada. Nenhum pedido,
evento Socket.IO, endpoint, schema ou autenticação Baileys foi alterado.
Os testes usam leitores/conexões simulados e não acessam Neon. Verificam o
SQL/escopo da transação; não substituem um teste futuro de concorrência real
em PostgreSQL descartável.
