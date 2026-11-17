# Registro operacional informado de migrations

Este projeto não possui runner ou tabela de histórico de migrations. Este arquivo é documentação versionada; não é um registro consultado ou escrito automaticamente no banco. Não criar uma tabela de controle apenas para esta sincronização.

| Identificador | Estado informado | Evidência / ação restante |
| --- | --- | --- |
| 007 — remoção do frete legado | Limpeza equivalente executada MANUALMENTE no Neon pelo operador, conforme confirmação nesta sessão | COMMIT informado; public.frete ausente, orders.frete_id ausente e fk_orders_frete removida. Data/hora original, branch e responsável nominal não foram fornecidos; não foram inventados. Anexar o registro operacional real ao processo de implantação. |
| 006 — fulfillment | Preparada; aplicação no Neon ainda pendente conforme contexto recebido | Aplicar sobre o schema pós-limpeza somente após preflight e confirmação independente dos pedidos históricos como DELIVERY. |

O arquivo `007_remove_legacy_frete.sql` agora é exclusivamente uma validação READ ONLY do baseline já alcançado, sem DROP/ALTER/CREATE, sem dados novos e sem exigir 006. Sua saída registra data e usuário DA VERIFICAÇÃO, não da remoção original. Guardar essa saída junto do registro de implantação após executá-la manualmente.

A ordem NUMÉRICA não corresponde à sequência efetiva deste ambiente: a limpeza equivalente à 007 ocorreu manualmente ANTES de 006. Não repetir o antigo SQL destrutivo para simular aplicação ordenada. Não recriar tabela/coluna para satisfazer arquivos antigos. Nenhum comando foi aplicado no Neon pelo agente nesta sincronização.
