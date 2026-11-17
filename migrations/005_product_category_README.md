# 005 — Categoria opcional de produto

Preparada para execução manual única de `005_product_category.sql`, integralmente,
em `neondb`, como `gamabn`, proprietário informado de `public.products`.
Não há execução automática nem aplicação no Neon nesta etapa.

Pré-condições informadas pelo proprietário: `category` ausente; RLS desativado
em `products`; `gama_app` existente, SELECT na tabela e escrita por coluna,
com INSERT, mas sem UPDATE em `restaurant_id`. Os testes locais não substituem
a conferência dos metadados reais. Confirmar banco, branch e role antes de aplicar.

A coluna é VARCHAR(80), nullable e sem default. Não há backfill nem DML:
produtos antigos recebem logicamente NULL. Nenhuma tabela, role, política,
índice ou configuração de modelo global é criada ou alterada.
Os únicos grants adicionados são INSERT(category) e UPDATE(category).
Os grants antigos de bootstrap permanecem históricos; a migration 005 adiciona
os novos. O manifesto e o verificador runtime representam o estado após 005.
A fixture local permanece deliberadamente anterior à migration.

ALTER TABLE exige lock exclusivo. `lock_timeout = '5s'` faz a transação falhar
em vez de aguardar indefinidamente por esse lock. Planejar uma janela breve.
Se ALTER ou GRANT falhar, a transação deve ser revertida integralmente.
Não usar IF NOT EXISTS: reaplicação ou coluna preexistente exige revisão, sem
aceitar silenciosamente uma definição incompatível. Não há rollback destrutivo
preparado; remover a coluna perderia categorias já preenchidas.

`005_product_category_verify.sql` é somente verificação, não uma migration.
Executar manualmente após aplicação e comparar com inventário anterior:
VARCHAR de 80, nullable, sem default; owner gamabn; RLS desativado;
SELECT de tabela e INSERT/UPDATE(category) verdadeiros; INSERT(restaurant_id)
verdadeiro; UPDATE(restaurant_id) e INSERT/UPDATE de tabela falsos.
Imediatamente após aplicação, antes de qualquer escrita de categorias,
count(category) deve ser zero. A contagem isolada não prova preservação de todos
os dados: usar inventário anterior e os testes de regressão como evidências.

Teste: `node tests/runtime-role-sql.cjs` a partir de BackEnd-lanchonete.
Cria e remove cluster PostgreSQL exclusivo em /tmp; não lê dotenv, DATABASE_URL
ou conexões remotas. Valida dados e ACLs anteriores, schema, NULL, limite Unicode,
reaplicação, manifesto e consultas de verificação. Testes de login/RLS existentes
dependem de socket local; skips devem ser reportados, não considerados aprovação.
