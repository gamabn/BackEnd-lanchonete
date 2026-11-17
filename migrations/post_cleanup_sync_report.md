# Sincronização após remoção manual de frete

## Resultado

A 006 foi validada em PostgreSQL descartável sobre o estado atual: public.orders com 10 colunas e três FKs, sem public.frete, orders.frete_id ou fk_orders_frete. Acrescenta quatro colunas e mantém as três FKs. Após aplicação: 14 colunas, PK e três FKs originais, seis CHECKs e o índice adicional. Não há qualquer dependência executável de frete/frete_id em 006. A revisão de 006 alterou apenas comentários.

A 007 foi convertida de uma proposta destrutiva nunca aplicada pelo agente para uma validação READ ONLY do baseline manual informado pelo operador. Não contém DROP, ALTER, CREATE, INSERT, UPDATE, DELETE, grants ou recriação de objetos. Pode ser repetida antes/depois de 006 sem mudanças. Inconsistências fazem o script falhar, sem correção automática.

Não existe runner nem tabela de histórico de migrations no projeto. APPLICATION_LOG.md registra explicitamente a execução manual equivalente da 007 conforme o relato do operador, sem alegar nova verificação independente no Neon ou inventar data/branch/responsável. A execução manual futura do SQL 007 atual apenas produz uma saída de verificação para guardar no registro operacional; não grava um ledger no banco.

## Arquivos modificados

Caminhos relativos a BackEnd-lanchonete, salvo quando indicado:

- migrations/006_order_fulfillment.sql — comentários compatíveis com o estado pós-limpeza; DDL/regras comerciais intactos.
- migrations/006_order_fulfillment_preflight.sql — presença explícita de tabela/FK antiga e fulfillment, além da coluna; sem referência direta à coluna removida.
- migrations/006_order_fulfillment_README.md — procedimento atual e resultados esperados com 10 -> 14 colunas/três FKs.
- migrations/007_remove_legacy_frete.sql — baseline exclusivamente READ ONLY, sem requisito de 006.
- migrations/007_remove_legacy_frete_verify.sql — comentário esclarece validade antes/depois de 006; inventário permanece de leitura.
- migrations/007_remove_legacy_frete_README.md — tratamento da execução manual já confirmada, substituindo instruções destrutivas antigas.
- migrations/README.md — aviso da ordem efetiva e ausência de runner.
- tests/order-fulfillment-migration.cjs — schema atual, preservação de três FKs, nenhum objeto antigo recriado, INSERT legado e PICKUP preservados.
- tests/frete-cleanup-migration.cjs — testes de baseline repetível e aplicação de 006 depois da limpeza já concluída.
- tests/fixtures/order-post-cleanup-schema.sql — fixture atual substitui tests/fixtures/order-frete-schema.sql; a antiga foi removida do workspace.
- docs/sql/frete-audit-readonly.sql (raiz do workspace) — marcado como inventário histórico pré-limpeza, não executar sobre o schema atual.
- docs/auditoria-tabela-frete.md (raiz do workspace) — aviso de que propostas destrutivas anteriores estão superadas.

Criados: migrations/APPLICATION_LOG.md e migrations/post_cleanup_sync_report.md. A fixture atual foi criada em substituição à anterior.

Não foram alterados OrderSalesService, controllers, aplicativo, dashboard, checkout ou Gama Bot. Nenhuma tabela/coluna antiga foi recriada, inclusive nas fixtures executadas nesta sincronização. Nenhum comando foi aplicado no Neon.

## Testes executados

PostgreSQL 18.6 descartável em /tmp, single-user, sem rede, dotenv, DATABASE_URL ou pool da aplicação. Cada cluster foi removido ao finalizar.

| Verificação | Resultado |
| --- | --- |
| node tests/order-fulfillment-migration.cjs | 10 aprovados |
| node tests/frete-cleanup-migration.cjs | 9 aprovados |
| node tests/runtime-role-sql.cjs | 8 aprovados, 2 ignorados |
| node tests/order-security.cjs | 37 aprovados |
| npx tsc --noEmit | passou |
| git diff --check | passou |

Total: 64 aprovados, zero falhas, dois ignorados por EPERM ao abrir socket Unix para testes de login/RLS. O sucesso de SET ROLE em single-user não foi apresentado como autenticação real ou verificação RLS.

Cobertura nova: ausência de orders bloqueia baseline; preflight reconhece ausência de frete/frete_id/FK e ausência/presença de fulfillment; baseline repetível antes e depois de 006; invariância de linhas, colunas, constraints, índices e ACLs nessas repetições; 006 exige confirmação histórica; valores históricos e três FKs preservados após 006; reexecução de 006 falha e reverte; INSERT real do serviço legado e INSERT de PICKUP funcionam sob gama_app sem objetos de frete. Um teste estático também impede reintrodução de DDL/DML no arquivo 007.

## SQL final recomendado

A única próxima alteração de schema é o conteúdo completo de `006_order_fulfillment.sql`, que já inclui BEGIN/COMMIT. Não executar a cópia antiga e destrutiva de 007. O novo 007 pode ser usado como verificação, não como limpeza.

Primeiro, sessão nova owner/grantor, a partir de BackEnd-lanchonete:

```psql
\set ON_ERROR_STOP on
\i migrations/007_remove_legacy_frete.sql
\i migrations/007_remove_legacy_frete_verify.sql
\i migrations/006_order_fulfillment_preflight.sql
```

PARAR e revisar: destino/branch, role/grants, baseline 10 colunas/três FKs/PK, ausência dos objetos antigos e das colunas novas. Conferir todos os pedidos existentes por evidências independentes, não pela ausência de endereço/frete. Manter pausa de escritas/DDL durante a revisão final e aplicação; repetir o inventário se algo mudar.

Somente depois de confirmar que os históricos são DELIVERY:

```psql
SET gama.orders_history_delivery_confirmed = 'true';
\i migrations/006_order_fulfillment.sql
RESET gama.orders_history_delivery_confirmed;
\i migrations/006_order_fulfillment_verify.sql
\i migrations/007_remove_legacy_frete.sql
\i migrations/007_remove_legacy_frete_verify.sql
```

O SET e o conteúdo de 006 devem executar na mesma sessão; não envolver 006 em outra transação. As verificações READ ONLY não aplicam nova limpeza. Guardar saídas e dados operacionais reais junto de APPLICATION_LOG.md conforme o processo de implantação. Nenhuma aplicação automática foi configurada.

## Riscos restantes

A existência/grants reais de gama_app e o schema devem ser conferidos no preflight do Neon antes de aplicar; resultados locais não substituem essa leitura. A limpeza manual confirmada não comprova que pedidos históricos são DELIVERY. ACCESS EXCLUSIVE pode bloquear atendimento; 006 usa lock_timeout=5s e statement_timeout=120s por comando. Reexecução de 006 não é idempotente e deve falhar; não mascarar divergências com IF NOT EXISTS. Em falha, interromper, ROLLBACK se necessário, limpar flags e fechar a sessão. A 007 atual verifica apenas o estado removido, não reconstrói a auditoria/data da operação manual nem altera qualquer objeto para fazê-lo coincidir.
