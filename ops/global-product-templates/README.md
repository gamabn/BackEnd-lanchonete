# Modelos globais de bebidas — carga manual

## Compatibilidade

A carga usa o formato lido por `ListProductTemplatesService` e `CreateProductFromTemplateService`: `product_templates(name, slug, active)` e `product_template_versions(template_id, version, configuration, active)`. IDs são gerados pelos defaults existentes. `configuration` contém `name`, `description`, `variants`, `optionGroups` e `variantGroupLimits`. Cada bebida tem uma variante com preço numérico, `optionGroups: []` e `variantGroupLimits: {}`. Não há alteração estrutural ou novo contrato.

| Slug estável | Nome | Variante | Preço ilustrativo/editável |
| --- | --- | --- | --- |
| bebida-refrigerante-cola-350ml | Refrigerante de cola | 350 ml | R$ 6,00 |
| bebida-suco-laranja-300ml | Suco de laranja | 300 ml | R$ 8,00 |
| bebida-agua-mineral-sem-gas-500ml | Água mineral sem gás | 500 ml | R$ 4,00 |
| bebida-cerveja-long-neck-330ml | Cerveja long neck | 330 ml | R$ 10,00 |

## Execução manual no Neon — não executada

1. Confirme no painel o projeto, branch e banco de destino. Use a conexão administrativa do proprietário da plataforma/tabelas, fora da aplicação e sem expor credenciais.
2. Confira o schema real: `slug` deve ter unicidade compatível com `ON CONFLICT (slug)`; as duas tabelas devem ter defaults para seus IDs e aceitar os campos acima. O repositório possui uma fixture local, não um dump autoritativo do Neon. Se houver incompatibilidade, interrompa e revise; não crie estruturas automaticamente.
3. Confira as permissões efetivas da conexão usada pelo backend conforme a seção abaixo.
4. Se o editor ficou com uma transação abortada após uma tentativa anterior, execute `ROLLBACK;` primeiro. Abra **o arquivo completo `01_seed_beverages.sql`** no SQL Editor e execute manualmente como proprietário. Não o conecte ao build, startup, rotas, frontend ou migrations. A carga verifica propriedade das duas tabelas antes de escrever. Há uma transação e timeout de cinco segundos para adquirir locks; em caso de falha, faça ROLLBACK no editor antes de tentar novamente.
**Não execute somente o trecho `RETURNING id INTO template_id`: ele depende de `DO $seed$ ... $seed$;` e não é um comando SQL autônomo. Selecione o script inteiro de `BEGIN;` a `COMMIT;`.**

5. Confira os avisos `Created`/`Preserved` e liste os modelos pela interface administrativa existente. Repetir o arquivo não cria novos modelos nem versões.

Os slugs são a identidade da carga. Se qualquer um já existir, será preservado integralmente: nome, configuração, IDs, versões e flags de ativo/inativo não são alterados. Mesmo um registro incompleto permanece intocado e recebe aviso de preservação, devendo ser revisado manualmente. A carga não corrige nem sobrescreve conteúdo preexistente; uma futura atualização de versão exige uma ação específica do proprietário.

O lock nas duas tabelas serializa cargas concorrentes. A versão 1 é inserida somente quando o próprio template foi criado nesta transação; uma falha reverte toda a carga. Não há dependência de um índice novo para versões.

## Segurança dos originais

As rotas administrativas de restaurante existentes listam os globais e criam cópias; não oferecem edição dos originais. A identidade do proprietário da cópia vem de `req.user_id`, não de um restaurante informado no corpo.

O plano de permissões existente (`ops/runtime-role/permissions.json` e `02_grants_existing.sql`) concede apenas SELECT em `product_templates` e `product_template_versions` para `gama_app`. Isso deve ser confirmado na conexão real: a role do backend não pode ser proprietária, superusuária, membro de role proprietária ou ter escrita nessas tabelas, inclusive por grants de PUBLIC. A credencial do proprietário da plataforma não deve ser usada no backend nem disponibilizada a administradores de restaurantes.

Consulta somente leitura, a executar manualmente com **a conexão efetiva do backend**, sem imprimir credenciais:

```sql
SELECT current_user, c.relname,
       pg_has_role(current_user, c.relowner, 'USAGE') AS owner_access,
       has_table_privilege(current_user, c.oid, 'SELECT') AS can_read,
       has_any_column_privilege(current_user, c.oid, 'INSERT') AS can_insert,
       has_any_column_privilege(current_user, c.oid, 'UPDATE') AS can_update,
       has_table_privilege(current_user, c.oid, 'DELETE') AS can_delete,
       has_table_privilege(current_user, c.oid, 'TRUNCATE') AS can_truncate,
       has_table_privilege(current_user, c.oid, 'TRIGGER') AS can_create_trigger
FROM pg_class c
WHERE c.oid IN ('public.product_templates'::regclass,
                'public.product_template_versions'::regclass);
```

Esperado: duas linhas, `can_read=true`, todos os outros indicadores false. Se divergir, interrompa a implantação e revise a configuração existente. Esta entrega não altera grants, roles, políticas RLS ou credenciais.

## Cópias e personalização

Depois da carga, os quatro modelos aparecem em “Modelos globais” pelo serviço existente. O restaurante seleciona um modelo e cria um rascunho com novos IDs. Nome, preço e disponibilidade são editados no editor já existente. O produto começa com `published=false`, e a publicação é explícita. A correção anterior permite uma variante sem grupos.

Editar uma cópia não modifica o JSON global nem cópias de outros restaurantes. Modelos privados, categorias, agrupamento visual, carrinho e checkout não são modificados. Os preços dos modelos são exemplos; cada restaurante define os preços das suas cópias.

## Testes locais

Execute na pasta `BackEnd-lanchonete`:

```bash
node tests/beverage-global-templates.cjs
```

O teste lê a configuração diretamente do SQL versionado e exercita os serviços existentes de listagem, cópia e edição com banco simulado. A idempotência, preservação de registros (inclusive colisão de slug) e rollback da carga são verificados em PostgreSQL local descartável em `/tmp`, via single-user, sem rede, dotenv ou conexão Neon. Não há migrations executadas. Somente as tabelas de fixture do banco temporário são criadas. Se `postgres`/`initdb` não estiverem disponíveis, o teste SQL é explicitamente ignorado.

A verificação local não comprova as permissões efetivas do Neon. Essa conferência permanece manual antes da execução real.

Resultado da entrega original (antes da revisão da coluna `name`): TypeScript do backend e frontend aprovado. 116 testes selecionados aprovados, sem falhas ou skips: 10 novos de bebidas, mais regressões de publicação, isolamento, modelos privados, edição e checkout. Os três testes SQL novos usaram PostgreSQL 18.6 local descartável; os testes de serviços usaram banco simulado. Nenhum arquivo de aplicação foi alterado e nenhuma conexão Neon foi usada.


## Revisão após execução manual no Neon

O erro de NOT NULL informado confirmou que `product_templates.name` é obrigatório no ambiente real. A fixture compartilhada antiga não documentava essa coluna. O seed agora fornece `name`, `slug` e `active` explicitamente; a fixture específica deste teste exige `name NOT NULL`. O cenário de preservação contém seis modelos anteriores, com seus nomes, IDs, flags e versões, e confere que permanecem intactos.

As migrations locais 001–004 não criam as tabelas globais; a 002 cria somente modelos privados. A tentativa de consulta somente leitura aos metadados do Neon nesta revisão falhou por DNS (`EAI_AGAIN`), portanto o restante do schema real não foi confirmado. O seed verifica colunas obrigatórias sem default antes dos INSERTs e interrompe se encontrar alguma não contemplada. Não supre campos desconhecidos com valores inventados.

Para conferir o schema manualmente sem alterar dados:

```sql
SELECT table_name, column_name, data_type, is_nullable, column_default,
       is_identity, is_generated
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('product_templates', 'product_template_versions')
ORDER BY table_name, ordinal_position;
```

O bloco PL/pgSQL completo foi mantido: `RETURNING ... INTO` guarda o ID recém-criado, e somente esse ID recebe uma versão 1. Slugs já existentes não recebem UPDATE, DELETE, reativação ou novas versões. A revisão não executa a carga, migrations ou alterações de schema no banco.

Validação da revisão: 11 testes aprovados. O teste SQL usa `name NOT NULL` e seis modelos anteriores, verificando preservação integral e repetição sem duplicações. Os testes SQL foram executados exclusivamente em PostgreSQL local descartável em `/tmp`; nenhuma carga, DDL ou mudança de dados foi executada no Neon.
