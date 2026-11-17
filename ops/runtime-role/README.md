# Role de runtime gama_app — preparação para execução manual

Nenhum script deste diretório foi executado no Neon. Nenhuma DATABASE_URL foi alterada. Scripts de criação/grants são propostas executáveis para revisão e autorização; não são migrations de startup. Não há criação de banco/branch remoto, remoção de dados, troca de ownership ou desativação de RLS.

## Diagnóstico e separação de responsabilidades

Dados informados pelo proprietário: neondb, PostgreSQL 16.15, DATABASE_URL atual com gamabn, SUPERUSER=false, BYPASSRLS=true, CREATEDB=true, CREATEROLE=true. Essa role não serve ao runtime dos templates privados: o helper da aplicação a rejeita com 503.

Manter gamabn como conexão administrativa de migrations/GRANTs e recuperação, fora do ambiente de runtime após a troca. Ela ou o proprietário real dos objetos executa 002 e concede privilégios. Não conceder gamabn/neon_superuser/pg_database_owner a gama_app; não fazer REASSIGN OWNED. A runtime é gama_app, LOGIN, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOINHERIT, sem memberships e sem ownership de banco/schema/tabelas.

No Neon, criar via SQL: a criação de role pelo Console/API pode atribuir neon_superuser. A role SQL não recebe essa associação automaticamente. NOINHERIT sozinho não basta para neutralizar memberships com SET ROLE; o kit exige ausência de memberships. A role recém-criada ainda recebe privilégios herdados de PUBLIC, independentemente de NOINHERIT; por isso há inventário e verificação de privilégios efetivos.

Fontes oficiais: https://neon.com/docs/manage/roles ; https://www.postgresql.org/docs/16/sql-grant.html ; https://www.postgresql.org/docs/16/sql-createrole.html ; https://www.postgresql.org/docs/16/sql-select.html .

## Auditoria das operações atuais

Revisados todos os acessos SQL de src/service, src/controller, src/socket e helpers src/security. O backend não executa DDL, TRUNCATE, COPY, CALL, setval ou gestão de roles. Também não invoca procedures customizadas explicitamente. Não precisa ser proprietário dos objetos nem de CREATE, REFERENCES, TRIGGER, TRUNCATE ou GRANT OPTION.

permissions.json é o manifesto das permissões extraídas do código. Todo objeto da tabela abaixo recebe SELECT em nível de tabela, necessário para joins, RETURNING e os SELECT * atuais (incluindo autenticação de restaurante). INSERT/UPDATE são concedidos somente nas colunas usadas, não em nível de tabela. D significa DELETE, já exposto pelo backend existente.

| Tabela | Escritas necessárias e motivação |
| --- | --- |
| restaurants | INSERT de cadastro; UPDATE de perfil, imagem, status e senha. Sem DELETE. O endpoint legado de exclusão chamado /user/delete usa DeleteClientService e apaga customers, não restaurants. |
| restaurant_types | Somente SELECT do catálogo global. |
| restaurant_type_links | INSERT/DELETE dos vínculos; não precisa UPDATE. |
| products | INSERT, UPDATE de campos de catálogo/publicação/disponibilidade, DELETE protegido de rascunho. |
| product_variants | INSERT, UPDATE de nome/preço/disponibilidade, DELETE protegido. |
| product_option_groups | INSERT, UPDATE de nome/obrigatoriedade/limites, DELETE protegido. |
| product_options | INSERT, UPDATE de nome/preço/disponibilidade (SQL usa alias), DELETE protegido. |
| product_variant_group_limits | INSERT, UPDATE de mínimos/máximos, DELETE. |
| product_templates / product_template_versions | Somente SELECT. Escrita de catálogo global continua administrativa. |
| customers | INSERT, UPDATE de contato/endereço, DELETE conforme endpoints atuais. |
| bairros | INSERT, UPDATE de nome/frete, DELETE. |
| orders | INSERT de pedido, UPDATE somente status, DELETE administrativo já existente. Não concede UPDATE total_price/payment/change_for. |
| order_items | INSERT de itens, DELETE administrativo. Sem UPDATE de preços históricos. |
| order_item_options | INSERT de snapshots. Sem UPDATE/DELETE direto; eventual ON DELETE CASCADE da FK existente é verificado no inventário, não exige grant DELETE ao chamador e não será adicionado por este kit. |
| chats | INSERT no checkout e DELETE administrativo; sem UPDATE. |
| chat_messages | INSERT e DELETE; read é apenas consultado pelo código atual. |
| password_tokens | INSERT/DELETE e UPDATE(token,expires_at), exigido pelo ON CONFLICT DO UPDATE na recuperação de senha. |
| restaurant_product_templates | INSERT(restaurant_id,name,description), UPDATE(name,description,updated_at), DELETE. Não concede atualização de proprietário. |
| restaurant_product_template_versions | INSERT(template_id,restaurant_id,version,configuration,active), UPDATE somente active, DELETE. JSON/versão anteriores não são atualizáveis pela runtime. |

SELECT FOR UPDATE/FOR SHARE exige UPDATE em pelo menos uma coluna das tabelas bloqueadas; as colunas de UPDATE já concedidas satisfazem os locks existentes, sem conceder atualização de IDs/proprietário ou preços de pedidos. Locks e transações não exigem uma permissão separada de LOCK/BEGIN.

As tabelas existentes continuam com o isolamento aplicado pelos endpoints/services já implementados; a role compartilhada não adiciona RLS a todo o banco. RLS de banco nesta fase é obrigatória nas duas tabelas privadas. Se o inventário mostrar RLS existente em outra tabela, 02/04 interrompem para revisão de compatibilidade, em vez de contorná-la.

## Sequences, defaults e funções

02/03 descobrem sequences serial/identity via pg_get_serial_sequence e sequences diretamente referenciadas em defaults via pg_depend. Consideram todas as colunas das tabelas nas quais a aplicação insere, incluindo IDs omitidos do INSERT. Concedem somente USAGE nas sequences descobertas em public, nunca ALL SEQUENCES/UPDATE/SELECT/setval. Se todos os IDs/defaults forem UUID, pode não haver nenhuma sequence necessária. Se uma dependência estiver em outro schema, o script interrompe para revisão explícita.

Nenhum GRANT EXECUTE global é emitido. O uso normal de funções pg_catalog depende das permissões já existentes; 04 verifica as funções essenciais ao UUID e contexto/RLS. 00 mostra funções não sistêmicas em defaults e triggers, sem exibir corpos ou registros de negócio. Wrappers de defaults que chamam sequences dinamicamente e efeitos de triggers não podem ser inferidos completamente apenas pelas queries da aplicação: precisam de revisão do schema real e eventual grant específico, nunca GRANT ALL FUNCTIONS.

Não se usa ALTER DEFAULT PRIVILEGES amplo: tabelas/colunas novas deverão receber grants explícitos com suas futuras migrations. Os scripts são aditivos; não revogam ACLs existentes de gama_app ou PUBLIC. 04 exige exatamente os privilégios do manifesto e bloqueia excesso herdado/antigo. TEMP pode continuar herdado do PUBLIC padrão do PostgreSQL; é reportado e não concedido pelo kit. Removê-lo de uma role isolada não neutraliza PUBLIC; qualquer hardening de PUBLIC é uma mudança separada, com revisão de impacto nos demais usuários. CREATE efetivo em banco/public é bloqueador, e nenhuma ACL de PUBLIC é alterada automaticamente.

## Ordem exata de execução futura

Todos os passos remotos abaixo dependem de autorização futura; não foram executados nesta preparação. Usar conexão administrativa direta do endpoint/branch confirmado, banco neondb. Para comandos, configurar externamente serviços libpq gama_admin (gamabn/proprietário) e gama_runtime (gama_app), com TLS e arquivos de segredo protegidos fora do repositório. Não colocar senhas em comandos, histórico, chat ou scripts versionados. Os nomes de serviço abaixo não contêm credenciais.

1. **Antes do Neon:** em máquina isolada com postgres/initdb/pg_ctl/psql e sockets locais permitidos, rodar `node tests/runtime-role-sql.cjs` e `node tests/private-template-migration.cjs` de BackEnd-lanchonete. Exigir ZERO skips nos casos reais de RLS. Eles criam somente cluster efêmero em /tmp, sem DATABASE_URL, dotenv ou Neon; neondb/gama_app nos testes existem apenas nesse cluster novo. Não executar fixtures SQL em banco externo.
2. **Inventário, gamabn:** `psql 'service=gama_admin' -X -v ON_ERROR_STOP=1 -f ops/runtime-role/00_inventory.sql`. Rever tabelas/colunas/constraints/sequences/owners/RLS/funções/triggers e privilégios de PUBLIC. As duas tabelas privadas podem estar ausentes neste ponto. Outras tabelas esperadas ausentes impedem cobrir todo o backend; não aplicar migrations não relacionadas automaticamente. Confirmar que gamabn é proprietário/grantor dos objetos ou usar o proprietário autorizado, e que pode criar roles. Guardar a DATABASE_URL atual em armazenamento seguro para reversão, sem imprimir seu valor.
3. **Criar a runtime via SQL, gamabn:** `psql 'service=gama_admin' -X -v ON_ERROR_STOP=1 -f ops/runtime-role/01_create_gama_app.sql`. Falha se gama_app já existir, para evitar alterar uma role desconhecida. Cria LOGIN com PASSWORD NULL: senha autenticação ainda não foi provisionada.
4. **Provisionar segredo manualmente:** definir senha forte para a role SQL já criada por um canal administrativo seguro, por exemplo reset de senha da role existente no Console Neon. Não criar a role pelo Console. Alternativa SQL, somente em cliente/canal seguro e sem versionar o segredo: `ALTER ROLE gama_app PASSWORD '<segredo fornecido por canal seguro>';` — o marcador não é uma senha e não deve ser executado literalmente. Confirmar novamente atributos e ausência de membership após provisionar. Só então configurar o serviço libpq gama_runtime. Não alterar DATABASE_URL do backend ainda.
5. **Grants existentes, proprietário/gamabn:** `psql 'service=gama_admin' -X -v ON_ERROR_STOP=1 -f ops/runtime-role/02_grants_existing.sql`. Transacional; exige todas as 18 tabelas existentes do manifesto, sem RLS inesperada, e a runtime sem privilégios administrativos/ownership/memberships/CREATE efetivo. Qualquer erro reverte seus grants. Não concede escrita em templates globais.
6. **Migration 002, gamabn/proprietário:** somente após a autorização específica para DDL, executar `psql 'service=gama_admin' -X -v ON_ERROR_STOP=1 -f migrations/002_restaurant_product_templates.sql` uma vez. Não incluir 001 nem executar 002 pelo startup. Se 002 já estiver aplicada, não reaplicar; comparar o schema/políticas com o arquivo. Os objetos novos permanecem de propriedade administrativa, nunca de gama_app.
7. **Grants privados, proprietário/gamabn:** `psql 'service=gama_admin' -X -v ON_ERROR_STOP=1 -f ops/runtime-role/03_grants_private.sql`. Exige ENABLE/FORCE RLS nas duas tabelas. Concede as colunas privadas específicas e sequences que eventualmente existirem. Não muda a migration nem as políticas.
8. **Login real da runtime:** `psql 'service=gama_runtime' -X -v ON_ERROR_STOP=1 -f ops/runtime-role/04_verify_runtime.sql`. Este script requer current_user=session_user=gama_app; não substitui por SET ROLE a partir da conexão administrativa. Verifica atributos, memberships, ausência de ownership/DDL/excessos, privilégios por coluna, sequences e RLS efetiva. Reexecutar 00 como admin e conferir as políticas reais; não pode existir política permissiva adicional ampliando acesso. 04 é uma verificação de metadados, não uma prova comportamental.
9. **Canário com gama_app, sem trocar todas as instâncias:** iniciar uma instância controlada do backend usando o novo segredo no ambiente dessa instância, preservando os demais valores. Validar manualmente autenticação/perfil, recuperação de senha por canal de teste, categorias, bairros, produtos simples/configuráveis, criação/publicação/desativação/exclusão de rascunho, cliente, checkout simples/misto, dashboard e chat. Operações que gravem dados remotos somente com autorização de homologação e dados de teste conhecidos; nenhum script de preparação as executa. Conferir as respostas e SQLSTATE 42501 sem registrar senhas/tokens/dados pessoais. Não repetir automaticamente um checkout de resultado incerto.
10. **Prova RLS no pooler efetivo:** com dois modelos de teste já criados manualmente e pertencentes a restaurantes distintos, executar `05_rls_readonly_probe.psql` via gama_runtime, passando `--set=restaurant_a=<UUID_A> --set=restaurant_b=<UUID_B> --set=template_a=<UUID_MODELO_A> --set=template_b=<UUID_MODELO_B>`. É somente leitura, altera contexto local transacional e termina com ROLLBACK; exige dados reais visíveis A/B e falha se o banco estiver vazio. Testes de bloqueio de escrita/rollback e services reais são feitos pelo teste local isolado, e operações HTTP por outro restaurante devem retornar 404 no canário. Confirmar COMMIT/ROLLBACK, limpeza de contexto e reuso da conexão com o pooler; nenhum SET de sessão.
11. **Troca manual:** após aprovar o canário, atualizar DATABASE_URL de cada ambiente/instância autorizada no gerenciador de segredos para gama_app, mesmo banco/branch e endpoint/TLS adequados. Recriar toda a URL com a nova credencial, com percent-encoding correto; não trocar apenas o username mantendo a senha de gamabn. Considerar que dotenv não sobrescreve variável já definida no processo. Reiniciar/reimplantar todas as instâncias e drenar pools antigos; uma conexão já aberta não muda de role ao editar o segredo. Verificar current_user efetivo pelo pool do backend, sem expor a URL. Frontend não recebe credenciais PostgreSQL.
12. **Observação:** repetir verificações de leitura, edição e pedido/tempo real em todos os processos. Só encerrar a janela após ausência de erros de privilégios e de regressões. Manter a credencial administrativa apenas em acesso operacional, sem injetá-la no runtime novo.

## Reversão

Se 02/03 falharem, a transação reverte seus próprios grants; o backend ainda usa a configuração antiga. Não aplicar 002 para corrigir erro não relacionado. Se 002 falhar, sua própria transação reverte a DDL; não limpar tabelas manualmente.

Se o canário/troca falhar: interromper rollout e novos pedidos na instância afetada; preservar evidências de SQLSTATE/operação/objeto sem segredos. Primeiro revisar o grant específico faltante com o manifesto/schema; não usar GRANT ALL, memberships administrativas ou BYPASSRLS como correção. Depois de um ajuste mínimo autorizado, repetir os gates e canário.

Se precisar restaurar serviço antes da correção: restaurar manualmente a DATABASE_URL administrativa anterior do armazenamento seguro e reiniciar/drenar pools de todas as instâncias afetadas. Operações legadas voltam à identidade anterior; os templates privados devem permanecer indisponíveis/503, pois o helper recusa gamabn com BYPASSRLS. Não remover esse guard, não desativar RLS e não ampliar políticas para contornar a reversão.

Não desfazer 002, não apagar templates/produtos/pedidos e não usar DROP OWNED/REASSIGN OWNED. Dados gravados validamente pela runtime continuam no mesmo banco. Verificar pedidos de resposta ambígua antes de qualquer nova tentativa. Após parar todas as instâncias/pools gama_app, pode-se executar manualmente `90_suspend_gama_app.sql` como admin para impedir novos logins; NOLOGIN não encerra conexões já abertas. Manter grants/dados para diagnóstico. Após corrigir, `ALTER ROLE gama_app LOGIN` deve ser uma ação explícita seguida da mesma validação completa.

## Limites da validação desta preparação

Scripts 01/02/03 e inventário foram exercitados em PostgreSQL 18.6 temporário local. As ACLs/flags de role e sequences foram inspecionadas em SQL real, sem mocks. Isso não prova enforcement de runtime/RLS: o ambiente atual proíbe socket Unix (EPERM), então o teste de login real gama_app/services/RLS fica explicitamente ignorado. Os dois testes comportamentais anteriores também continuam dependentes de PostgreSQL normal acessível. PostgreSQL de destino informado é 16.15; os casos precisam rodar na versão 16 antes da liberação. Não houve conexão com Neon ou alteração do backend/frontend nesta tarefa.

Resultado desta preparação: 5 testes SQL/catálogo aprovados em PostgreSQL 18.6 local, zero falhas e 1 integração real gama_app/RLS explicitamente ignorada por EPERM no socket. O teste real foi preparado para usar exatamente 01/02/03/04, os services da aplicação e a sonda 05; não foi substituído por mocks. O inventário também lista funções SECURITY DEFINER não sistêmicas e se a role pode executá-las; revisar eventual EXECUTE herdado de PUBLIC antes da liberação, sem revogações globais automáticas.
