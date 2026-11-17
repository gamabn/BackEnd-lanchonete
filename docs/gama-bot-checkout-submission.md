# H.5A — operação interna de submissão

WhatsAppCheckoutSubmission.submit recebe contexto confiável, autorização H.2,
snapshot H.3 (ou null para recuperação) e intenção H.4 previamente registrada.
Não está ligada ao menu, worker ou endpoint. A confirmação continua simulada.
Nenhum evento Socket.IO ou mensagem WhatsApp é emitido pela operação.

## Unidade transacional

1. H.2 adquire um client e executa BEGIN ISOLATION LEVEL SERIALIZABLE como primeira
   instrução. Revalida telefone/cliente/restaurante na mesma conexão.
2. O contexto fornecido deve coincidir com a sessão autorizada. A intenção é
   reconstruída do estado vivo e comparada com a chave/hash/conteúdo registrados.
3. SELECT FOR UPDATE bloqueia a intenção. Ela deve existir: a operação nunca
   gera/registra uma nova chave como efeito colateral de confirmação ou retry.
4. COMPLETED recupera fullOrder no mesmo client e verifica seu proprietário.
   Não revalida o catálogo nem exige o token de revisão perdido após reinício.
5. PENDING/RECOVERABLE_FAILURE exige snapshot válido e revalidação H.3. Mudanças
   retornam review_required, sem INSERT de pedido. A intenção recebe
   RECOVERABLE_FAILURE/REVALIDATION_REQUIRED na própria transação.
6. Somente unchanged permite persistValidatedOrder(client, validated): cabeçalho,
   itens, snapshots dos adicionais, chat e leitura de fullOrder. Esse helper é
   extraído do OrderSalesService e é também usado pelo fluxo HTTP existente.
7. completeCheckoutIntent associa o pedido na mesma transação. H.2 verifica outra
   vez a sessão antes de COMMIT. Sucesso só é retornado depois do COMMIT resolver.

A validação compartilhada agora retorna os IDs dos proprietários junto aos dados
precificados, evitando fornecer outros IDs separadamente ao helper de escrita.
O helper não abre conexão/transação nem emite eventos. Nunca chamar execute()
dentro do escopo H.2: execute continua sendo a fronteira transacional do HTTP.
O controller HTTP existente continua responsável por sua própria notificação.

## Resultados e retomada

- success: fullOrder, intentId e replayed. Duplicatas retornam o pedido original.
- review_required: motivos e prévia quando disponível; exige outra revisão e
  confirmação. Não promover a prévia automaticamente a snapshot confirmado.
- recoverable_failure: SERIALIZATION_CONFLICT, COMMIT_UNKNOWN ou TRANSACTION_ABORTED,
  com a chave original e reuseSameKey=true. Não inclui erros SQL/credenciais.
- rejected: autorização/contexto inválido, chave/payload incompatível, infraestrutura
  ausente ou rejeição por constraints. Não criar outra chave como fallback.

Não há retry automático dentro da transação nem espera por resposta WhatsApp.
40001/40P01 exigem nova autorização e repetição da unidade inteira com a MESMA
chave. Erros SQL na identificação transacional preservam seu código, sem serem
confundidos com cliente não autorizado. Nenhum efeito externo deve ocorrer no retry.

Erro durante COMMIT é conservadoramente COMMIT_UNKNOWN (exceto conflitos de
serialização/deadlock identificados). O client é descartado. ROLLBACK posterior
não prova que o servidor não commitou. Reautenticar e retomar com a mesma chave:
COMPLETED devolve o pedido; intenção sem conclusão exige snapshot/revisão vigente
antes de persistir. Banco indisponível permanece incerto, sem fallback de criação.
Não há uma segunda transação automática para gravar falha depois de um rollback:
a intenção previamente commitada pode continuar PENDING, o que é seguro ao retomar
sob lock. Falha de resposta WhatsApp depois do commit não deve repetir a criação.

Após reinício, a correlação durável deve recuperar a chave e seu payload H.4.
A autorização precisa ser nova, baseada no transporte atual, nunca em telefone
lido do payload armazenado. O estado original pode ser reconstruído para replay,
mas não concede autorização nem substitui nova revisão de uma intenção pendente.
O token H.3 é local ao processo: null só permite replay de intenção COMPLETED;
para pendente retorna review_required. A restauração do estado no worker fica
para a integração futura, ainda não implementada nesta etapa.

## Condições antes de ativar

- Aplicar/verificar migration 008 somente com autorização separada e preflight;
  ela não foi executada no Neon. Ausência da tabela retorna NOT_CONFIGURED antes
  de inserir pedidos. Conferir grants reais e compatibilidade do schema.
- Integrar captura da revisão ao momento em que é exibida, registro da intenção
  antes da confirmação e correlação persistente da chave com a sessão lógica.
- Conectar o getter vivo/identityRevision H.2, estados de submissão e recuperação
  após reinício, sem confiar em IDs/telefone extraídos de texto.
- Tratar resultados tipados na UI, inclusive revisão nova e COMMIT_UNKNOWN, sem
  manter transação aberta por interação com o cliente.
- Validar a versão/schema e o papel de runtime em staging com cópia do schema real.
- Projetar notificações pós-commit separadamente. Este serviço não importa servidor,
  controllers, autenticação Baileys ou Socket.IO e não entrega eventos.

## Validação e limites

Testes unitários usam mocks. Integração real usa cluster privado em /tmp, sem TCP,
verifica data_directory/listen_addresses e substitui o pool global por um objeto
que proíbe qualquer acesso. Cria somente fixtures e pedidos de teste, aplica 008
somente ali, reinicia o cluster e remove tudo no final. Nenhum dado de produção.

Os testes de perda de COMMIT injetam falha antes/depois de executar COMMIT no
PostgreSQL real; não simulam todas as falhas possíveis de rede/replicação.
Concorrência SERIALIZABLE é exercitada com conexões reais. O restart reconstrói
sessão e autorização a partir do payload durável e transporte novo; não representa
uma integração de recuperação já disponível no worker. Produção continua inativa.
