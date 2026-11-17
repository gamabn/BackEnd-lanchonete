# H.4 — intenções duráveis de checkout WhatsApp

> A proposta foi estendida em H.6C: ver [correlação ativa](../docs/gama-bot-active-intent.md).
> O protocolo ativo substitui as limitações históricas de descoberta descritas abaixo;
> a migration segue NÃO aplicada em produção. Inclui active, retired_at, geração
> gerada do JSON e índice UNIQUE parcial para todos os estados ativos.

## Escopo e estado de implantação

Migration 008 preparada, não aplicada no Neon ou em produção. A aplicação não a
executa automaticamente. Testada somente em um cluster PostgreSQL 18.6 novo,
privado, em /tmp, sem TCP, sem carregar database.ts, dotenv ou DATABASE_URL.
O cluster usa fsync/synchronous_commit ligados e é removido ao fim dos testes.
As linhas de orders usadas ali são pais sintéticos mínimos para testar FKs;
nenhum serviço comercial de pedidos foi chamado por esses testes específicos.
A compatibilidade com o PostgreSQL/schema efetivo do Neon ainda exige preflight.

Não há integração com o botão, confirmação simulada, persistência comercial ou
Socket.IO nesta etapa. O execute existente continua sem idempotência própria;
não chamar execute dentro de uma transação de intenção, pois abriria outro client.

## Estrutura aditiva

- Nova tabela public.whatsapp_checkout_intents com intent_id UUID como PK global.
- Vinculação imutável a restaurante, cliente, sessão, conta, remetente e telefone
  confirmado pelo transporte. FKs impedem cliente/pedido de outro proprietário.
- canonical_checkout contém contrato/itens/revisão normalizados e identidade de
  escopo; checkout_hash SHA-256 inclui todo esse conteúdo. CHECK confere o hash
  no próprio PostgreSQL, sem instalar extensões. Outro CHECK vincula o escopo
  canônico às colunas de proprietário/identidade da linha.
- Estados PENDING, COMPLETED e RECOVERABLE_FAILURE. Somente COMPLETED possui
  order_id; somente falha recuperável possui failure_code, de lista restrita.
- order_id único impede associar um pedido a duas intenções.
- Trigger impede alterar chave, escopo, conteúdo ou hash e impede desfazer uma
  conclusão. Um estado recuperável deve voltar a PENDING antes de concluir.
- Índice de recuperação por proprietário/sessão/identidade/data.
- A FK de clientes reutiliza customers_email_owner_key(id, restaurant_id), criada
  pela migration 003. A 008 verifica tipos UUID e a chave UNIQUE não diferível,
  validada e com índice válido/pronto antes de criar objetos. Não cria outro índice
  equivalente em customers. Ausência/divergência exige revisão, não aplicação
  automática de 003 ou criação de um índice alternativo.
- Somente orders recebe um índice pai novo, necessário à FK composta do pedido.
  Não há remoção de colunas, reescrita de dados históricos ou alteração de schema
  Prisma. A criação desse índice pode bloquear escritas e precisa de janela.
- 006 fornece colunas/constraints/grants usados pela persistência comercial;
  007 atual só verifica a limpeza do frete legado. O DDL de 008 não comprova que
  esse baseline funcional esteja aplicado. Conferir metadata e histórico do alvo.
  Os testes aplicam as versões antigas sem modificá-las somente em banco novo e
  descartável. Nada foi aplicado ou verificado diretamente no Neon nesta etapa.
- gama_app recebe SELECT, INSERT em colunas explícitas e UPDATE somente de
  state/order_id/failure_code/active/retired_at. Sem DELETE e sem UPDATE do vínculo/conteúdo.

As FKs RESTRICT preservam a recuperação: exclusão de um pedido/cliente referenciado
passará a ser bloqueada. Revisar os fluxos administrativos de exclusão e a política
de retenção antes de aplicar. Não substituir por CASCADE, que apagaria a proteção.
O payload e a identidade contêm dados pessoais: restringir acesso, backups e logs;
a política de retenção/anonimização deve preservar a impossibilidade de replay.

## Chave estável e hash

newCheckoutIntentId() gera UUID aleatório somente para uma intenção explicitamente
nova. createCheckoutIntentRequest(session, intentId) exige essa chave; nunca cria
uma chave como efeito colateral de uma confirmação/retry. Não usar message_id
como chave comercial: mensagens distintas podem confirmar a mesma intenção.
Não usar somente hash do carrinho como chave: dois pedidos legítimos podem ter
exatamente os mesmos itens.

O pedido adaptado pela H.1 e os valores exibidos, endereço, frete, configurações,
nomes e pagamento compõem JSON canônico, com chaves ordenadas, decimais exatos e
IDs de opções ordenados. Débito e crédito continuam distintos no hash, apesar
do contrato legado Cartao. O telefone é a identidade semântica; a origem da
metainformação de transporte é validada, mas mudar a fonte mantendo o mesmo
telefone não altera o hash. H.2 continua responsável pela geração de identidade.

A chave deve ser registrada e commitada ANTES de mostrar a confirmação e mantida
na sessão. O session_id deve identificar a sessão lógica persistente: não gerar
outro UUID em cada reconexão/reinício. Mudança de conta, remetente ou telefone
não autoriza recuperar o escopo antigo por aproximação.
Se a resposta desse registro se perder, recuperar/listar as intenções
do escopo; nunca gerar outra chave automaticamente. listCheckoutIntents retorna
as 20 mais recentes: quando houver ambiguidade ou a chave original não estiver
nessa janela, interromper a criação e reconciliar. Não escolher uma intenção por
coincidência de hash nem concluir que nenhuma existe porque a lista está vazia.
Intenções diferentes não são deduplicadas entre si: a integração futura precisa
reutilizar a chave original. Uma revisão materialmente diferente requer nova
confirmação e uma intenção explicitamente nova, sem sobrescrever a antiga.

## Uso transacional futuro

1. prepareCheckoutIntent registra a chave em uma transação curta separada e a
   compara com eventual linha existente. Payload/escopo divergente gera conflito.
2. Na confirmação futura, H.2 deve autorizar o cliente vivo. No MESMO client da
   transação, lockCheckoutIntent faz SELECT FOR UPDATE da intenção/escopo/hash.
3. Se COMPLETED, recuperar o order_id original. Não criar pedido novamente e não
   depender da disponibilidade/preço atual do catálogo para informar esse resultado.
4. Se PENDING, executar H.3 e só persistir em unchanged, usando o mesmo client.
   Inserção do pedido/itens/chat e completeCheckoutIntent precisam ocorrer na
   mesma transação. Qualquer erro exige rollback da transação inteira.
5. completeCheckoutIntent grava COMPLETED + order_id; FKs e unicidade verificam
   o proprietário. Commit torna pedido e vínculo visíveis atomicamente.
6. Concorrentes esperam o lock ou recebem falha de serialização. Em 40001/40P01,
   repetir toda a unidade, com nova autorização e a MESMA chave, nunca somente
   a última query ou a criação do pedido. Não repetir efeitos externos no retry.

Essas funções não abrem nem encerram transações. Chamar lock/complete em autocommit
não fornece a garantia do protocolo. A infraestrutura fica desacoplada de H.2/H.3;
a integração e a persistência na conexão fornecida são pendências da etapa futura.
Todos os parâmetros de escopo devem vir de sessão/transporte/autorização internos,
nunca de texto do WhatsApp. A chave não é credencial e a recuperação exige nova
identificação/validação do proprietário, inclusive após reiniciar o worker.

PENDING significa intenção registrada sem conclusão visível, não autorização
para criar livremente: pode haver outra transação em andamento. Só o lock decide.
RECOVERABLE_FAILURE é registrado após rollback comprovado, em transação curta
nova; retry volta a PENDING. Não armazenar SQL, telefone ou stack em failure_code.
H.3 exigindo nova revisão não autoriza modificar o hash da intenção existente.

## Resultado incerto de COMMIT

Timeout/queda de conexão durante COMMIT não prova rollback. Não retornar um
fracasso definitivo, marcar falha ou gerar chave nova com base apenas no erro.
Em conexão nova, reautenticar o proprietário e consultar/bloquear a MESMA intenção:

- COMPLETED: recuperar e informar o pedido original; não criar nem reemitir efeitos
  nesta etapa. Perda da resposta WhatsApp é independente do sucesso do commit.
- PENDING/RECOVERABLE_FAILURE após adquirir o lock: nenhuma conclusão está
  commitada para essa intenção. Pela atomicidade exigida, não há pedido commitado
  por esse protocolo sem o vínculo. Reautorizar/revalidar antes de qualquer retry.
- Sem linha: pode ser registro inicial não commitado ou chave/contexto incorreto.
  Não fazer fallback criando outro pedido. Reconciliar a chave original.
- Banco indisponível: manter resultado como pendente/incerto até recuperar acesso.

markCheckoutIntentRecoverable bloqueia/reconsulta e nunca rebaixa COMPLETED.
Não substitui reconciliação e não prova ausência de pedidos criados fora deste
protocolo. Nenhuma entrega exatamente uma vez de WhatsApp/Socket.IO é prometida.

## Implantação futura — NÃO executada

1. Autorizar separadamente a implantação; fazer backup e conferir ambiente/banco.
2. Executar apenas o preflight 008 com acesso autorizado. Conferir tipos UUID,
   chaves pais, objetos homônimos, gama_app, propriedade/grants, versão, capacidade,
   fsync/synchronous_commit e impacto dos índices sobre escritas.
3. Testar o schema real restaurado em ambiente descartável/staging, incluindo
   exclusão administrativa, permissões e recuperação. As fixtures mínimas não
   comprovam compatibilidade com todos os constraints/triggers da produção.
4. Programar janela com owner/grantor. Aplicar 008 uma única vez, como arquivo
   transacional. Falha deve reverter tudo; não usar IF NOT EXISTS para esconder
   divergência. Não foi preparado rollback destrutivo automático.
5. Verificar constraints, trigger, índices e grants. Registrar a aplicação conforme
   o processo manual do repositório. Ainda não habilitar submissão do bot.
6. Só após autorização da etapa seguinte, integrar registro/correlação durável,
   recuperação e persistência atômica; manter a confirmação simulada até lá.

Testes: node tests/checkout-idempotency.cjs e
node tests/checkout-idempotency-postgres.cjs. Se os binários postgres/initdb/pg_ctl
não existirem, o teste real declara skip explicitamente; falhas de startup ou SQL
não são tratadas como sucesso. Em sandbox sem sockets, a execução do cluster
privado exige permissão para esse comando específico. Sem ambiente real aprovado,
as garantias de concorrência devem ser reportadas como ainda não verificadas.


## Revisão H.6A e usuário restrito

O teste checkout-idempotency-postgres agora aplica 003 na fixture e verifica que
conindid da FK aponta para a chave existente, sem customers_checkout_owner_idx.
Também verifica rollback integral da 008 quando a chave 003 não existe.

checkout-submission-postgres usa conexão LOGIN gama_app para autorização,
revalidação, registro/lock da intenção, persistência e replay. O owner prepara
somente schema/fixtures e injeções administrativas de falha. Os grants são os de
ops/runtime-role/02_grants_existing.sql mais os statements versionados de
003/006/008, executados exclusivamente nesse cluster privado.

Nenhum grant de produção foi modificado. O teste negativo retira temporariamente
os INSERTs de fulfillment_type/subtotal/delivery_fee/pickup_address e comprova
NOT_CONFIGURED com rollback; restaura somente o GRANT já presente na 006 e o
mesmo checkout passa. Conferir esses grants no alvo antes de ativar. Não ampliar
UPDATE de orders nem dar DELETE/UPDATE de payload à tabela de intenções.

Se uma versão anterior de 008 já tiver sido aplicada em outro ambiente, não
reexecutar este arquivo nem remover índices automaticamente. Inspecionar as FKs
e preparar uma correção separada autorizada para esse ambiente.
