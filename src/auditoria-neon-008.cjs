
const fs = require("node:fs");
require("dotenv").config({ override: false });
const { Client } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL ausente.");
  process.exit(1);
}

const preflight = fs.readFileSync(
  "migrations/008_whatsapp_checkout_idempotency_preflight.sql",
  "utf8",
);

// Aceita somente o formato SELECT/SHOW do arquivo revisado.
// Não constitui um analisador SQL genérico.
const statements = preflight
  .replace(/--[^\n]*/g, "")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

if (statements.some((s) => !/^(SELECT|SHOW)\b/i.test(s))) {
  console.error("Preflight divergiu: contém comando diferente de SELECT/SHOW.");
  process.exit(1);
}

const tables = [
  "restaurants",
  "customers",
  "bairros",
  "products",
  "product_variants",
  "product_options",
  "orders",
  "order_items",
  "order_item_options",
  "chats",
  "customer_email_challenges",
  "whatsapp_checkout_intents",
];

const extra = [
  [
    "identificacao",
    `
    SELECT current_database(), current_user, session_user,
           inet_server_addr(), current_setting('server_version') AS version,
           current_setting('transaction_read_only') AS read_only,
           current_setting('statement_timeout') AS statement_timeout,
           current_setting('lock_timeout') AS lock_timeout
  `,
  ],
  [
    "ssl",
    `
    SELECT ssl, version, cipher
    FROM pg_stat_ssl WHERE pid = pg_backend_pid()
  `,
  ],
  [
    "tabelas_e_autoridade",
    `
    SELECT c.relname, c.relkind, pg_get_userbyid(c.relowner) AS owner,
           c.relrowsecurity, c.relforcerowsecurity,
           pg_has_role(current_user, c.relowner, 'USAGE') AS owner_role_effective,
           has_schema_privilege(current_user, n.oid, 'USAGE') AS schema_usage,
           has_schema_privilege(current_user, n.oid, 'CREATE') AS schema_create
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[])
    ORDER BY c.relname
  `,
    [tables],
  ],
  [
    "colunas_tipos_defaults_e_permissoes",
    `
    SELECT c.relname AS table_name, a.attname AS column_name,
           format_type(a.atttypid,a.atttypmod) AS type,
           a.attnotnull, a.attidentity, a.attgenerated,
           pg_get_expr(d.adbin,d.adrelid) AS default_or_generated,
           has_column_privilege(current_user,c.oid,a.attnum,'SELECT') AS can_select,
           has_column_privilege(current_user,c.oid,a.attnum,'INSERT') AS can_insert,
           has_column_privilege(current_user,c.oid,a.attnum,'UPDATE') AS can_update
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname='public' AND c.relname=ANY($1::text[])
      AND a.attnum>0 AND NOT a.attisdropped
    ORDER BY c.relname,a.attnum
  `,
    [tables],
  ],
  [
    "constraints",
    `
    SELECT c.conrelid::regclass::text AS table_name,
           c.conname,c.contype,c.convalidated,c.condeferrable,
           pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND t.relname=ANY($1::text[])
    ORDER BY table_name,c.conname
  `,
    [tables],
  ],
  [
    "indices",
    `
    SELECT t.relname AS table_name,x.relname AS index_name,
           i.indisprimary,i.indisunique,i.indisvalid,
           i.indisready,i.indimmediate,
           pg_get_indexdef(i.indexrelid) AS definition
    FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid
    JOIN pg_class x ON x.oid=i.indexrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND t.relname=ANY($1::text[])
    ORDER BY t.relname,x.relname
  `,
    [tables],
  ],
  [
    "colisoes_de_relacoes",
    `
    SELECT c.relname,c.relkind
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[])
  `,
    [
      [
        "orders_checkout_owner_idx",
        "whatsapp_checkout_intents",
        "whatsapp_checkout_intents_pkey",
        "whatsapp_checkout_intents_order_id_key",
        "whatsapp_checkout_scope_created_idx",
        "whatsapp_checkout_one_active_scope_idx",
      ],
    ],
  ],
  [
    "colisao_de_tipo",
    `
    SELECT t.typname,t.typtype
    FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
    WHERE n.nspname='public' AND t.typname='whatsapp_checkout_intents'
  `,
  ],
  [
    "funcao_guard_existente",
    `
    SELECT p.oid::regprocedure::text AS function_name,
           pg_get_userbyid(p.proowner) AS owner
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='guard_whatsapp_checkout_intent'
  `,
  ],
  [
    "triggers",
    `
    SELECT c.relname AS table_name,t.tgname,t.tgenabled,
           pg_get_triggerdef(t.oid) AS definition
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[])
      AND NOT t.tgisinternal
    ORDER BY c.relname,t.tgname
  `,
    [tables],
  ],
  [
    "rls_policies",
    `
    SELECT schemaname,tablename,policyname,roles,cmd
    FROM pg_policies
    WHERE schemaname='public' AND tablename=ANY($1::text[])
  `,
    [tables],
  ],
  [
    "funcoes_necessarias",
    `
    SELECT p.oid::regprocedure::text AS function_name,p.provolatile,
           has_function_privilege(current_user,p.oid,'EXECUTE') AS can_execute
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='pg_catalog' AND p.proname IN
      ('sha256','convert_to','encode','jsonb_typeof','jsonb_build_array',
       'now','clock_timestamp','hashtextextended','pg_advisory_xact_lock')
    ORDER BY function_name
  `,
  ],
  [
    "linguagem",
    `
    SELECT lanname,lanpltrusted,
           has_language_privilege(current_user,oid,'USAGE') AS can_use
    FROM pg_language WHERE lanname='plpgsql'
  `,
  ],
  [
    "sequences_permissoes",
    `
    SELECT c.relname,
           has_sequence_privilege(current_user,c.oid,'USAGE') AS can_use,
           has_sequence_privilege(current_user,c.oid,'SELECT') AS can_select
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='S'
    ORDER BY c.relname
  `,
  ],
  [
    "orders_volume_estimado",
    `
    SELECT c.reltuples AS estimated_rows,c.relpages,
           pg_table_size(c.oid) AS table_bytes,
           pg_indexes_size(c.oid) AS indexes_bytes,
           pg_total_relation_size(c.oid) AS total_bytes,
           s.n_live_tup,s.n_dead_tup,s.n_mod_since_analyze,
           s.last_analyze,s.last_autoanalyze
    FROM pg_class c LEFT JOIN pg_stat_user_tables s ON s.relid=c.oid
    WHERE c.oid=to_regclass('public.orders')
  `,
  ],
  [
    "locks_nos_pais",
    `
    SELECT c.relname,l.mode,l.granted,count(*) AS lock_count
    FROM pg_locks l JOIN pg_class c ON c.oid=l.relation
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public'
      AND c.relname IN ('orders','customers','restaurants')
    GROUP BY c.relname,l.mode,l.granted
    ORDER BY c.relname,l.mode
  `,
  ],
  [
    "transacoes_resumo_sem_conteudo",
    `
    SELECT count(*) FILTER (WHERE xact_start IS NOT NULL) AS transactions,
           max(clock_timestamp()-xact_start) AS oldest_transaction_age,
           count(*) FILTER (WHERE state='idle in transaction') AS idle_transactions
    FROM pg_stat_activity
    WHERE datname=current_database() AND pid<>pg_backend_pid()
  `,
  ],
];

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // mesma configuração do backend
  connectionTimeoutMillis: 10000,
  query_timeout: 20000,
});

(async () => {
  let stage = "conexao";
  try {
    await client.connect();
    stage = "transacao";
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '30s'");

    for (let i = 0; i < statements.length; i++) {
      stage = `preflight_${i + 1}`;
      const result = await client.query(statements[i]);
      console.log(JSON.stringify({ check: stage, rows: result.rows }));
    }
    for (const [name, sql, params] of extra) {
      stage = name;
      const result = await client.query(sql, params);
      console.log(JSON.stringify({ check: name, rows: result.rows }));
    }
    await client.query("ROLLBACK");
    console.log("LEITURA CONCLUIDA; nenhuma migration executada.");
  } catch (error) {
    // Evita imprimir mensagens que possam conter detalhes da conexão.
    console.error(
      JSON.stringify({
        status: "FALHOU",
        stage,
        code: error.code || "SEM_SQLSTATE",
      }),
    );
    await client.query("ROLLBACK").catch(() => {});
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
})();
