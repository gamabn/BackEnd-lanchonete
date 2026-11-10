# Migration 001 — tipos de estabelecimentos

## Escopo

`001_restaurant_types.sql` é SQL versionável, transacional, preparado para PostgreSQL 16 do Neon. Não há ORM ou sistema de migrations encontrado no projeto; nenhum comando foi conectado à inicialização da aplicação.

A migration cria somente `public.restaurant_types`, `public.restaurant_type_links` e o índice único parcial da categoria principal. Não recria/altera `restaurants` e não altera produtos, clientes, pedidos ou chats. Não cria vínculos nem classifica estabelecimentos antigos. APIs, telas, autenticação e checkout permanecem inalterados.

O índice impõe **no máximo uma** principal por estabelecimento. Zero categorias ou somente adicionais continuam permitidos para compatibilidade. A exigência de **exatamente uma principal** nos novos cadastros será implementada no backend em etapa futura.

## Compatibilidade com o banco existente

O código existente usa `restaurants.id` como identidade do estabelecimento, mas não há dump de schema ou migrations anteriores que confirmem seu tipo físico. O Neon não foi consultado ou alterado nesta etapa.

Antes de criar qualquer tabela, a migration exige que `public.restaurants.id` exista e seja UUID. A FK exige também chave primária/constraint única ou índice único não parcial compatível nesse campo. Estruturas incompatíveis causam erro e rollback; nenhuma conversão/reescrita é executada. Se o banco real usar outro schema/tipo, a migration precisa ser revista após inspecionar os metadados, antes de aplicação autorizada.

UUIDs usam `gen_random_uuid()` nativa do PostgreSQL 16, sem instalar `uuid-ossp` ou `pgcrypto`. O usuário que aplicar precisa de privilégios de criação no schema public e de REFERENCES no campo referenciado. As FKs usam RESTRICT em atualização/exclusão, sem cascata que remova registros automaticamente. A ordenação inicial da lista não é prometida: tabelas não possuem ordem implícita.

Recursos conferidos na documentação oficial do PostgreSQL 16:

- [UUID e gen_random_uuid](https://www.postgresql.org/docs/16/functions-uuid.html).
- [Chaves estrangeiras e unicidade da coluna referenciada](https://www.postgresql.org/docs/16/ddl-constraints.html).
- [Índices únicos parciais](https://www.postgresql.org/docs/16/indexes-partial.html).
- [INSERT ON CONFLICT](https://www.postgresql.org/docs/16/sql-insert.html).
- [Bloco DO/PLpgSQL](https://www.postgresql.org/docs/16/sql-do.html).

## Seed e versionamento

São inseridos Pizzaria/pizzaria, Lanchonete/lanchonete, Hamburgueria/hamburgueria, Pastelaria/pastelaria, Restaurante/restaurante, Açaiteria/acaiteria e Outros/outros.

O INSERT é idempotente por `ON CONFLICT (slug) DO NOTHING`: repeti-lo não duplica categorias nem altera IDs, nomes ou active já existentes. Categorias personalizadas também permanecem intactas. Os testes extraem esse mesmo INSERT do arquivo versionado e o executam repetidamente.

O **arquivo estrutural completo deve ser aplicado uma única vez**, como migration 001. CREATE TABLE/INDEX não usam IF NOT EXISTS deliberadamente: uma tabela homônima incompatível não será silenciosamente aceita. Reaplicar o arquivo completo falha e reverte a transação, sem modificar estruturas existentes; isso é distinto da idempotência do INSERT inicial. Não existe criação automática de uma terceira tabela de controle de migrations.

## Testes isolados

Na raiz do repositório:

```bash
node BackEnd-lanchonete/tests/restaurant-types-migration.cjs
```

Exige `postgres` e `initdb` locais no PATH, da mesma versão. O teste inicializa um cluster privado em `/tmp`, cria seus próprios bancos/fixtures e usa `postgres --single` com entrada por arquivo. Não abre portas, não usa psql/libpq, não importa database.ts/dotenv e não lê DATABASE_URL ou parâmetros de conexão do Neon. Os únicos registros modificados pelos testes são fixtures novas e isoladas; a limpeza remove somente o diretório temporário criado pelo próprio processo.

Se os binários estiverem ausentes, os testes são explicitamente ignorados. Falhas de inicialização ou de assertions SQL não são tratadas como sucesso. Saída esperada: 9 testes aprovados quando o PostgreSQL local estiver disponível.

Para executar especificamente com binários PostgreSQL 16 instalados em outro diretório:

```bash
GAMA_TEST_POSTGRES_BIN=/caminho/postgresql-16/bin/postgres \
GAMA_TEST_INITDB_BIN=/caminho/postgresql-16/bin/initdb \
node BackEnd-lanchonete/tests/restaurant-types-migration.cjs
```

Cobertura:

1. FKs rejeitam estabelecimento/tipo inexistentes e restringem remoção de pais vinculados.
2. Chave composta impede duplicação de vínculos; slug único impede duplicação de categorias.
3. Índice parcial impede segunda principal, tanto por INSERT quanto por UPDATE.
4. Várias adicionais são permitidas, com principal independente por estabelecimento.
5. Estabelecimentos anteriores preservam dados/estrutura e podem permanecer sem categoria.
6. Seed repetido preserva IDs, nomes, active e tipos personalizados.
7. is_primary nulo não burla o índice; defaults e formato dos slugs são válidos.
8. ID de restaurante com tipo incompatível bloqueia a migration sem conversão.
9. Ausência de unicidade em restaurants.id provoca rollback, inclusive da tabela nova já criada.

Nesta execução, os testes SQL rodaram em **PostgreSQL 18.6 local**, sem mocks de banco. Não havia PostgreSQL 16 disponível; a compatibilidade da sintaxe foi conferida pela documentação da versão 16, mas não houve execução nessa versão ou no Neon. Os testes de restrição referencial aceitam os SQLSTATEs 23503/23001 de rejeição de exclusões por referência entre versões.

## Aplicação futura — não executada

Somente após autorização, com o destino revisado e `GAMA_MIGRATION_DATABASE_URL` configurada fora de arquivos versionados, a partir da raiz:

```bash
PGCLIENTENCODING=UTF8 psql -X \
  --dbname="${GAMA_MIGRATION_DATABASE_URL:?Defina a conexão autorizada}" \
  --set=ON_ERROR_STOP=1 \
  --file=BackEnd-lanchonete/migrations/001_restaurant_types.sql
```

O arquivo inclui BEGIN/COMMIT. ON_ERROR_STOP interrompe no primeiro erro, e a desconexão reverte a transação não confirmada. Não há script destrutivo de down, DROP, ALTER ou limpeza de dados de produção.

## Resultado desta execução

- 9 testes novos da migration aprovados em PostgreSQL 18.6 local real.
- Os 100 testes anteriores continuam aprovados: 109 aprovações no total.
- O teste anterior de integração Socket.IO continua ignorado por EPERM ao abrir porta local.
- TypeScript do backend e frontend aprovado.
- Nenhum arquivo de aplicação ou teste anterior foi modificado nesta etapa.

**A aplicação no Neon permanece pendente de autorização.**
