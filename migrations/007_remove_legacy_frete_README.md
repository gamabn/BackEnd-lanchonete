# 007 — baseline da limpeza já executada manualmente

O operador confirmou que a transação de limpeza no Neon terminou com COMMIT: public.frete, orders.frete_id e fk_orders_frete foram removidos. A 006 ainda não foi aplicada. Esta informação substitui a antiga proposta de ordem 006 -> limpeza 007.

## Tratamento do arquivo 007

`007_remove_legacy_frete.sql` foi convertido em uma asserção exclusivamente READ ONLY. Não contém operações destrutivas, não recria nada, não exige 006 e pode ser repetido antes ou depois dela. Falha se orders não existir ou se qualquer um dos três objetos antigos ainda estiver presente. Não tenta corrigir divergências automaticamente.

A saída indica `already_applied_manually_state_verified`, banco, usuário e horário da verificação. Não escreve um histórico no banco e não prova a data da remoção original. O registro operacional informado está em `APPLICATION_LOG.md`, pois não existe runner/tabela de migrations no projeto. Não cadastrar silenciosamente uma migration em uma tabela que não existe, nem criar nova infraestrutura.

`007_remove_legacy_frete_verify.sql` permanece um inventário de leitura válido antes e depois de 006. O SQL destrutivo anterior NÃO deve ser executado, inclusive se recuperado de uma versão antiga do repositório.

## Ordem correta neste ambiente

1. Validar a limpeza manual com o 007 atual (somente leitura) e salvar a saída.
2. Executar preflight da 006. Baseline esperado: 10 colunas em orders, três FKs e PK; tabela/coluna/FK antigas ausentes, fulfillment ainda ausente.
3. Conferir os pedidos existentes e confirmar por evidência independente que todos são DELIVERY. A ausência de frete_id/endereço não comprova isso.
4. Aplicar exclusivamente 006 em sessão dedicada do owner/grantor e somente depois da confirmação histórica.
5. Verificar 006 e repetir a validação READ ONLY da 007. Esperado: 14 colunas, três FKs, PK, seis CHECKs adicionais e o índice restaurant_id/created_at.

O procedimento exato está em `006_order_fulfillment_README.md`. Não repetir a limpeza, não aplicar ordem numérica com o SQL antigo e não recriar frete/frete_id.

## Testes desta sincronização

`tests/frete-cleanup-migration.cjs` agora verifica o baseline atual e a sequência validação 007 -> aplicação 006 -> validação 007, incluindo repetição sem mudanças. A fixture é `tests/fixtures/order-post-cleanup-schema.sql`, com 10 colunas e três FKs. A fixture antiga `order-frete-schema.sql` foi substituída; nenhuma tabela/coluna antiga é criada pelos testes atualizados.

O teste específico de 006 também parte do schema atual, preserva as três FKs e confirma a ausência dos objetos antigos. A cobertura financeira de DELIVERY/PICKUP e o INSERT legado são mantidos.

Nenhuma operação foi executada no Neon nesta sincronização. O sucesso dos testes locais não é apresentado como nova inspeção independente do Neon.
