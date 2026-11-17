# 006 — aplicação sobre o schema atual após limpeza manual

## Estado informado do Neon e compatibilidade

O operador confirmou COMMIT da remoção manual de public.frete, orders.frete_id e fk_orders_frete. A 006 ainda está preparada, não aplicada. A sequência efetiva é limpeza manual equivalente à 007 -> aplicação futura da 006. Não repetir a proposta antiga de DROPs, não recriar objetos e não executar o antigo inventário de frete sobre um schema que já não os possui.

A 006 não usa frete_id ou public.frete em nenhum comando executável. A revisão alterou apenas os comentários desse arquivo para refletir o estado atual. O SQL permanece aditivo e transacional, sem mudanças de contrato comercial.

Baseline esperado antes da 006: orders com 10 colunas, três FKs e PK, sem os seis CHECKs de fulfillment. Depois: 14 colunas, as mesmas três FKs e PK, seis CHECKs adicionais e um índice adicional. As definições/valores das colunas existentes são preservados.

## Colunas, regras e legado

- fulfillment_type VARCHAR(10) NOT NULL DEFAULT 'DELIVERY'.
- subtotal e delivery_fee NUMERIC(12,2), nullable e sem default, para não inventar históricos.
- pickup_address JSONB nullable e sem default.
- PICKUP exige subtotal/total não nulos, delivery_fee não nulo e zero, ausência de bairro/endereço de entrega e total igual à soma.
- DELIVERY legado pode omitir subtotal/frete. Quando os dois componentes existem, total é obrigatório e deve ser a soma.
- Valores conhecidos não podem ser negativos ou NaN. Modalidade explícita NULL é rejeitada.
- O backend ainda deverá implementar a submissão comercial de PICKUP; a migration não a habilita sozinha.

Seis CHECKs: orders_fulfillment_type_check, orders_pickup_no_delivery_check, orders_pickup_fee_check, orders_subtotal_nonnegative_check, orders_delivery_fee_nonnegative_check e orders_total_components_check.

Somente um índice novo: orders_restaurant_created_at_idx (restaurant_id, created_at DESC), alinhado à listagem por restaurante/data. Não há índices isolados redundantes.

INSERT por coluna para gama_app: delivery_address, bairro_id e as quatro colunas novas. UPDATE continua status-only. Nenhum grant de tabela inteira ou concessão financeira de UPDATE foi acrescentado. A existência/grants efetivos da role precisam ser conferidos no preflight do ambiente real; não são inferidos dos testes locais.

## Registro da limpeza manual

O arquivo 007 atual é somente READ ONLY, independente de 006, e rejeita baseline incompleto sem corrigi-lo. Não executar cópia antiga do arquivo. `APPLICATION_LOG.md` registra a execução equivalente informada pelo operador, sem inventar data, branch ou responsável. Não há tabela/runner de migrations; nenhuma nova tabela de registro será criada por estes arquivos.

## Procedimento exato — apenas para execução manual autorizada

1. Revisar o SQL completo de 006 e confirmar destino/branch, owner/grantor e gama_app. Registrar backup/branch de recuperação e evidências operacionais conforme procedimento existente.
2. Abrir sessão NOVA dedicada. Caminhos abaixo são relativos a BackEnd-lanchonete. Executar SOMENTE esta primeira etapa:

```psql
\set ON_ERROR_STOP on
\i migrations/007_remove_legacy_frete.sql
\i migrations/007_remove_legacy_frete_verify.sql
\i migrations/006_order_fulfillment_preflight.sql
```

3. Parar e conferir os resultados: frete_table_present/frete_id_present/frete_fk_present devem ser false; fulfillment_type_present deve ser false antes de 006; 10 colunas e três FKs preservadas. Conferir também nulabilidade, triggers/RLS, índices e privilégios, inclusive INSERT de delivery_address. Qualquer divergência deve ser investigada, sem recriação ou DROP automático.
4. Revisar os pedidos existentes contra evidências confiáveis de modalidade. Contagens e ausência de endereço não bastam. Se houver retirada histórica ou informação insuficiente, NÃO confirmar a flag. Pausar escritas e alterações de schema durante a revisão final/aplicação; repetir o preflight após qualquer alteração concorrente.
5. SOMENTE após concluir a revisão histórica, na mesma sessão, executar:

```psql
-- Não executar este SET antes da confirmação independente dos pedidos existentes.
SET gama.orders_history_delivery_confirmed = 'true';
\i migrations/006_order_fulfillment.sql
RESET gama.orders_history_delivery_confirmed;
\i migrations/006_order_fulfillment_verify.sql
\i migrations/007_remove_legacy_frete.sql
\i migrations/007_remove_legacy_frete_verify.sql
```

O arquivo 006 já contém BEGIN/COMMIT: não envolver em outra transação ou executar parcialmente. Em editor SQL do Neon, executar o conteúdo completo dos arquivos de cada etapa; preservar a mesma sessão entre SET e 006. A flag é uma declaração operacional, não uma classificação automática. Em tabela vazia, a migration não exige declaração histórica.

6. Conferir 14 colunas, três FKs e PK originais, seis CHECKs validados e o índice adicional. Com escritas ainda pausadas, contagem de pedidos e valores antigos devem coincidir; históricos terão DELIVERY e subtotal/delivery_fee/pickup_address NULL. A 007 deve continuar confirmando a ausência dos objetos antigos. `invalid_pickup_orders` deve ser zero. Conferir grants efetivos.
7. Encerrar a sessão e retomar atendimento após verificar o resultado. Homologar INSERT legado em banco descartável/branch de teste; não criar pedidos artificiais no banco real para validar a migration.

Se houver erro: interromper, executar ROLLBACK se a conexão permanecer aberta, RESET da flag e fechar a sessão; iniciar revisão nova antes de tentar novamente. A 006 não é idempotente: repetição falha e reverte sem ocultar schema divergente. Não usar IF NOT EXISTS para forçar sucesso.

## Riscos e limites

ACCESS EXCLUSIVE bloqueia leitura/escrita; lock_timeout=5s e statement_timeout=120s limitam a espera/duração por comando. Grants incorretos ou ausência de gama_app fazem a transação falhar e reverter. DROP manual já confirmado não implica autorização para classificar históricos como DELIVERY. A validação 007 não reconstrói evidências da execução original, apenas confere o estado atual. Não houve nova conexão/alteração no Neon nesta sincronização.

## Testes e arquivos

Resultados completos e arquivos modificados estão em `post_cleanup_sync_report.md`. As fixtures atuais possuem somente o schema pós-limpeza; os testes não recriam frete/frete_id, não leem dotenv/DATABASE_URL e não acessam Neon. O SQL completo recomendado para a única próxima alteração de schema é `006_order_fulfillment.sql`.
