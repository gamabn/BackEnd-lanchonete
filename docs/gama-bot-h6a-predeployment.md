# H.6A — correções estruturais sem ativação

A 008 preparada reutiliza a chave customers_email_owner_key(id, restaurant_id)
da migration 003. O novo guard valida os seis tipos UUID e a chave UNIQUE
validada/não diferível com índice válido/pronto. A ausência é erro antes de criar
o índice de orders ou a tabela de intenções. Não há criação de índice duplicado
em customers. Hash, vínculo de proprietário, FKs, estados e trigger de imutabilidade
foram preservados. Nenhum arquivo SQL de 001 a 007 foi modificado.

O preflight 008 agora inventaria a chave reutilizada, as colunas de fulfillment e
o baseline de frete legado. Não executa/aplica migrations antigas. O registro da
006 pendente no repositório precisa ser reconciliado com metadata real por operador
autorizado. Testar/aplicar 008 não comprova por si só que a persistência comercial
possui as colunas, constraints e grants da 006. A 007 atual é somente leitura.

server.ts configura configureOrdersSocket(io) uma única vez. O teste de bootstrap
executa esse arquivo em VM, com HTTP/Redis substituídos, e conta as configurações.
Os testes normais de Socket.IO continuam verificando tickets, isolamento da sala
por restaurante e reconexão com servidor/clientes locais de teste. A implementação
de autenticação, salas, emissão e Redis não foi alterada; não há publicação nova.

## Permissões exercitadas

O teste transacional conecta como gama_app, LOGIN sem SUPERUSER/BYPASSRLS,
CREATEDB/CREATEROLE/INHERIT ou propriedade de relações. Não é SET ROLE de um
superusuário no caminho comercial. O pool global da aplicação é proibido pelo
teste. O cluster em /tmp é novo, sem TCP; data_directory é verificado antes do
primeiro DDL. Todas as configurações de conexão são explícitas e locais.

| Caminho | Permissões utilizadas |
| --- | --- |
| Identificação/autorização | SELECT customers e bloqueio FOR SHARE |
| Revalidação | SELECT/FOR SHARE em restaurants, customers, bairros, products, product_variants, product_option_groups, product_variant_group_limits e product_options |
| Idempotência | SELECT, INSERT nas colunas de vínculo/hash e UPDATE somente de state/order_id/failure_code; FOR UPDATE |
| Pedido | SELECT e INSERT das colunas usadas em orders, incluindo fulfillment_type, subtotal, delivery_fee e pickup_address |
| Itens/adicionais/chat | SELECT e INSERT de colunas explícitas em order_items, order_item_options e chats |
| Bootstrap/conexão | CONNECT no banco privado neondb e USAGE em public; nenhum DDL como aplicação |

O fixture utiliza os grants existentes de ops/runtime-role/02_grants_existing.sql,
os statements da 003/006 e os novos da 008. Nenhuma ampliação adicional foi
necessária nesse schema descartável. Os privilégios de locking são exercitados
pelo caminho completo, em vez de inferidos apenas pela presença de SELECT.

Foi comprovado por teste negativo: sem INSERT nas quatro colunas novas da 006,
a submissão retorna NOT_CONFIGURED e reverte o pedido. Restaurar o GRANT já
versionado na 006, somente no cluster descartável, permite concluir com a mesma
chave. Isso não autoriza executar o GRANT no Neon sem verificar o ambiente.

Também são recusados SET ROLE para owner, CREATE em public, DELETE de intenções,
UPDATE de total_price e alteração de checkout_hash. Não há grant de UPDATE amplo
em orders nem de DELETE/alteração de payload na tabela nova. O trigger atualiza
updated_at sem exigir autorização de UPDATE dessa coluna ao cliente.

O teste completo aplica os arquivos 003, 006 e 007 inalterados sobre uma fixture
legada nova e sem pedidos históricos, depois 008. O teste menor de idempotência
usa pais mínimos, prova a falha sem 003 e sua reutilização depois. Não se presume
que 003/006/007 estejam efetivamente aplicadas no banco de produção.

## Cobertura e limites

Os testes reais incluem ENTREGA/RETIRADA, itens, adicionais e chat; validação e
alterações de preço/endereço; rollback; identidade alterada; concorrência;
40001; commit incerto; recovery/replay após restart; rejeição de contexto e
payload divergentes; constraints de proprietário e permissões negativas.

Os ajustes de grants dos testes são locais e temporários. Nenhuma migration,
DDL, grant ou consulta foi executada no Neon. Versão, schema, triggers, RLS,
privilégios e defaults reais continuam sujeitos a preflight/staging autorizado.
Os pais fictícios e seu histórico vazio não comprovam a modalidade de pedidos
históricos reais exigida pelo procedimento da 006.

Continuam pendentes, sem implementação nesta etapa: registro durável da intenção
no fluxo WhatsApp; restauração/correlação da sessão; estados reais e reconciliação
operacional; publicação recuperável pós-commit; decisão sobre débito/crédito.
A confirmação continua simulada e não existe ativação por variável de ambiente.
