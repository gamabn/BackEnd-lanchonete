const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const seed = fs.readFileSync('ops/global-product-templates/01_seed_beverages.sql', 'utf8');
const templates = JSON.parse(seed.match(/\$beverages\$([\s\S]*?)\$beverages\$/)[1]);
const expected = [
  ['Refrigerante de cola', '350 ml', 6], ['Suco de laranja', '300 ml', 8],
  ['Água mineral sem gás', '500 ml', 4], ['Cerveja long neck', '330 ml', 10],
];
function load(file, mocks = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, Buffer, console: { error() {} }, require(name) { assert.ok(name in mocks, name); return mocks[name]; } });
  return exports;
}
function harness() {
  const originals = structuredClone(templates), products = [], variants = [], trace = [];
  let before;
  const client = { release() {}, async query(sql, p = []) {
    trace.push(sql);
    if (sql === 'BEGIN') { before = structuredClone({ products, variants }); return { rows: [] }; }
    if (sql === 'COMMIT') return { rows: [] };
    if (sql === 'ROLLBACK') { products.splice(0, products.length, ...before.products); variants.splice(0, variants.length, ...before.variants); return { rows: [] }; }
    if (sql.includes('FROM public.restaurants')) return { rowCount: p[0] ? 1 : 0 };
    if (sql.includes('FROM public.product_templates')) {
      assert.match(sql, /pt.active = TRUE/); assert.match(sql, /ptv.active = TRUE/);
      if (sql.includes("configuration ->> 'name'")) return { rows: originals.map(t => ({ slug: t.slug, name: t.configuration.name, version: 1 })) };
      const template = originals.find(t => t.slug === p[0]);
      return { rowCount: template ? 1 : 0, rows: template ? [{ version: 1, configuration: template.configuration }] : [] };
    }
    if (sql.includes('INSERT INTO public.products')) {
      assert.match(sql, /TRUE, FALSE/);
      const product = { id: randomUUID(), restaurant_id: p[0], name: p[1], description: p[2], price: p[3], available: true, published: false, category: p[4] ?? null };
      products.push(product); return { rows: [{ ...product }] };
    }
    if (sql.includes('INSERT INTO public.product_variants')) {
      const variant = { id: randomUUID(), product_id: p[0], name: p[1], price: p[2], available: true };
      variants.push(variant); return { rows: [{ ...variant }] };
    }
    if (sql.includes('SELECT published, available FROM public.products')) {
      assert.match(sql, /restaurant_id = \$2 FOR UPDATE/);
      return { rows: products.filter(t => t.id === p[0] && t.restaurant_id === p[1]) };
    }
    if (sql.includes('count(*)::integer')) return { rows: [{ variants: variants.filter(v => v.product_id === p[0]).length, groups: 0 }] };
    if (sql.includes('UPDATE public.product_variants')) {
      const variant = variants.find(v => v.id === p[0] && v.product_id === p[1]);
      if (!variant) return { rowCount: 0 };
      Object.assign(variant, { name: p[2], price: p[3], available: p[4] }); return { rowCount: 1 };
    }
    if (sql.includes('UPDATE public.products')) {
      assert.match(sql, /restaurant_id = \$2/);
      const product = products.find(t => t.id === p[0] && t.restaurant_id === p[1]);
      if (p[5]) product.category = p[6];
      Object.assign(product, { name: p[2], description: p[3], available: p[4], price: Math.min(...variants.filter(v => v.product_id === p[0] && v.available).map(v => Number(v.price))) });
      return { rows: [{ ...product }] };
    }
    assert.fail(`Unexpected write/query: ${sql}`);
  } };
  const pool = { connect: async () => client, query: (...args) => client.query(...args) };
  const transaction = load('src/service/product/productTransaction.ts', { '../../database': { pool } });
  const errors = load('src/service/product/productValidation.ts');
  const guard = load('src/service/productTemplates/ensurePublishedProductValid.ts', { '../product/productValidation': errors, './ValidateProductPublicationService': {} });
  const creator = load('src/service/productTemplates/CreateProductFromTemplateService.ts', { '../../database': { pool }, '../product/productValidation': errors });
  const editor = load('src/service/productTemplates/UpdateConfiguredProductService.ts', {
    '../product/productTransaction': transaction, '../product/productValidation': errors, './ensurePublishedProductValid': guard,
  });
  const listing = load('src/service/productTemplates/ListProductTemplatesService.ts', { '../../database': { pool } });
  return { originals, products, variants, trace, creator: new creator.CreateProductFromTemplateService(), editor: new editor.UpdateConfiguredProductService(), listing: new listing.ListProductTemplatesService() };
}

test('versioned SQL data has exactly four global templates with one expected variant and no groups', () => {
  assert.equal(templates.length, 4); assert.equal(new Set(templates.map(t => t.slug)).size, 4);
  templates.forEach((t, index) => {
    assert.deepEqual([t.configuration.name, t.configuration.variants[0].name, t.configuration.variants[0].price], expected[index]);
    assert.equal(t.configuration.variants.length, 1);
    assert.deepEqual(t.configuration.optionGroups, []); assert.deepEqual(t.configuration.variantGroupLimits, {});
  });
});
test('seed explicitly supplies required template name and keeps RETURNING inside the full DO block', () => {
  assert.match(seed, /INSERT INTO public\.product_templates \(name, slug, active\)\s+VALUES \(item -> 'configuration' ->> 'name', item ->> 'slug', TRUE\)/);
  assert.ok(seed.indexOf('RETURNING id INTO template_id') > seed.indexOf('DO $seed$'));
  assert.ok(seed.indexOf('RETURNING id INTO template_id') < seed.lastIndexOf('$seed$;'));
  assert.match(seed, /a\.attnotnull AND NOT a\.atthasdef/);
});
test('existing listing contract exposes all four models without application changes', async () => {
  const h = harness(); const list = await h.listing.execute();
  assert.equal(list.length, 4); assert.deepEqual(list.map(t => t.name), expected.map(t => t[0]));
});
for (const template of templates) {
  test(`${template.configuration.name}: copies and edits preserve global and other restaurant`, async () => {
    const h = harness(), original = JSON.stringify(h.originals);
    const a = await h.creator.execute({ restaurantId: 'restaurant-A', templateSlug: template.slug });
    const b = await h.creator.execute({ restaurantId: 'restaurant-B', templateSlug: template.slug });
    assert.notEqual(a.product.id, b.product.id);
    assert.equal(a.product.restaurant_id, 'restaurant-A'); assert.equal(a.product.published, false);
    assert.equal(a.variantsCreated, 1); assert.equal(a.groupsCreated, 0);
    const va = h.variants.find(v => v.product_id === a.product.id), vb = h.variants.find(v => v.product_id === b.product.id);
    assert.notEqual(va.id, vb.id);
    assert.equal(va.name, template.configuration.variants[0].name); assert.equal(va.price, template.configuration.variants[0].price);
    const untouched = JSON.stringify({ product: h.products[1], variant: vb });
    const input = { name: 'Nome da minha loja', description: 'Personalizado', available: false, groups: [],
      variants: [{ id: va.id, name: 'Embalagem personalizada', price: '12.50', available: true, groupLimits: [] }] };
    await assert.rejects(h.editor.execute('restaurant-B', a.product.id, input), e => e.status === 404);
    const edited = await h.editor.execute('restaurant-A', a.product.id, input);
    assert.equal(edited.name, input.name); assert.equal(edited.price, 12.5); assert.equal(edited.available, false);
    assert.equal(JSON.stringify(h.originals), original);
    assert.equal(JSON.stringify({ product: h.products[1], variant: h.variants.find(v => v.product_id === b.product.id) }), untouched);
    assert.equal(h.trace.some(sql => /(?:INSERT INTO|UPDATE|DELETE FROM) public\.(?:product_templates|product_template_versions|restaurant_product_templates)/.test(sql)), false);
  });
}
test('runtime manifest keeps global models read-only and routes offer no global mutation', () => {
  const permissions = JSON.parse(fs.readFileSync('ops/runtime-role/permissions.json', 'utf8'));
  for (const name of ['product_templates', 'product_template_versions']) assert.deepEqual(permissions[name], { insert: [], update: [], delete: false });
  const routes = fs.readFileSync('src/routes.ts', 'utf8');
  assert.match(routes, /"\/products\/from-template",\s*isAuthentication,/);
  assert.doesNotMatch(routes, /router\.(?:post|put|patch|delete)\(\s*"\/products\/templates(?:"|\/:)/);
});

const postgres = process.env.GAMA_TEST_POSTGRES_BIN || 'postgres';
const initdb = process.env.GAMA_TEST_INITDB_BIN || 'initdb';
const environment = { PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C' };
const available = [postgres, initdb].every(bin => spawnSync(bin, ['--version'], { env: environment }).status === 0);
const fixture = fs.readFileSync('tests/fixtures/runtime-role-schema.sql', 'utf8').split('\n')
  .filter(line => /^CREATE TABLE public\.product_template(?:s|_versions) /.test(line)).join('\n')
  // Production requires name; the shared legacy fixture omits it.
  .replace('slug TEXT UNIQUE', 'name TEXT NOT NULL, slug TEXT UNIQUE');
function withPostgres(fn) {
  const cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'gama-beverage-seed-'));
  try {
    const init = spawnSync(initdb, ['-D', cluster, '-A', 'trust', '-U', 'gama_seed_test', '--no-sync', '--locale=C', '--encoding=UTF8'], { env: environment, encoding: 'utf8', timeout: 30000 });
    assert.equal(init.status, 0, init.stdout + init.stderr);
    function run(sql, shouldPass = true) {
      const inputPath = path.join(cluster, 'input.sql'); // Single-user -j separates input at blank lines, including inside dollar quotes.
      fs.writeFileSync(inputPath, sql.replace(/\n(?:[ \t]*\n)+/g, '\n'));
      const fd = fs.openSync(inputPath, 'r'); let result;
      try {
        result = spawnSync(postgres, ['--single', '-D', cluster, '-c', 'exit_on_error=true', '-c', 'log_checkpoints=off', '-c', 'log_min_messages=error', '-j', 'postgres'], {
          env: environment, stdio: [fd, 'pipe', 'pipe'], encoding: 'utf8', timeout: 30000,
        });
      } finally { fs.closeSync(fd); }
      assert.ifError(result.error);
      if (shouldPass) assert.equal(result.status, 0, result.stdout + result.stderr);
      else assert.notEqual(result.status, 0);
      return result;
    }
    fn(run);
  } finally { fs.rmSync(cluster, { recursive: true }); }
}
const sqlOptions = { skip: available ? false : 'Local postgres/initdb unavailable' };

test('SQL rerun avoids duplicates and preserves existing global models/versions in local PostgreSQL', sqlOptions, () => withPostgres(run => {
  run(`${fixture}
INSERT INTO product_templates(name,slug,active)
SELECT 'Existing model '||i, 'existing-global-'||i, FALSE FROM generate_series(1,6) i;
INSERT INTO product_template_versions(template_id,version,configuration,active)
SELECT id, v, jsonb_build_object('name','Original','version',v), v=2 FROM product_templates CROSS JOIN generate_series(1,2) v;
CREATE TEMP TABLE original_templates AS SELECT * FROM product_templates;
CREATE TEMP TABLE original_versions AS SELECT * FROM product_template_versions;
${seed}
CREATE TEMP TABLE first_templates AS SELECT * FROM product_templates;
CREATE TEMP TABLE first_versions AS SELECT * FROM product_template_versions;
${seed}
DO $test$ BEGIN
 IF (SELECT count(*) FROM product_templates) <> 10 OR (SELECT count(*) FROM product_template_versions) <> 16 THEN RAISE EXCEPTION 'Duplicate or missing seed rows'; END IF;
 IF EXISTS ((SELECT * FROM product_templates EXCEPT SELECT * FROM first_templates) UNION ALL (SELECT * FROM first_templates EXCEPT SELECT * FROM product_templates)) THEN RAISE EXCEPTION 'Template changed on rerun'; END IF;
 IF EXISTS ((SELECT * FROM product_template_versions EXCEPT SELECT * FROM first_versions) UNION ALL (SELECT * FROM first_versions EXCEPT SELECT * FROM product_template_versions)) THEN RAISE EXCEPTION 'Version changed on rerun'; END IF;
 IF EXISTS (SELECT * FROM original_templates EXCEPT SELECT * FROM product_templates) THEN RAISE EXCEPTION 'Existing template changed'; END IF;
 IF EXISTS (SELECT * FROM original_versions EXCEPT SELECT * FROM product_template_versions) THEN RAISE EXCEPTION 'Existing version changed'; END IF;
 IF EXISTS (SELECT 1 FROM product_templates WHERE slug LIKE 'existing-global-%' AND active) THEN RAISE EXCEPTION 'Existing model reactivated'; END IF;
 IF EXISTS (SELECT 1 FROM product_template_versions WHERE configuration ? 'variants' AND (jsonb_array_length(configuration->'variants') <> 1 OR configuration->'optionGroups' <> '[]'::jsonb OR configuration->'variantGroupLimits' <> '{}'::jsonb OR NOT active OR version <> 1)) THEN RAISE EXCEPTION 'Invalid beverage shape'; END IF;
END $test$;`);
}));
test('SQL preserves colliding slugs, inactive versions and incomplete existing models', sqlOptions, () => withPostgres(run => {
  run(`${fixture}
INSERT INTO product_templates(name,slug,active) VALUES ('Custom inactive','${templates[0].slug}',FALSE),('Custom incomplete','${templates[1].slug}',TRUE);
INSERT INTO product_template_versions(template_id,version,configuration,active)
SELECT id,7,'{"name":"Custom existing beverage"}'::jsonb,FALSE FROM product_templates WHERE slug='${templates[0].slug}';
CREATE TEMP TABLE preserved_templates AS SELECT * FROM product_templates;
CREATE TEMP TABLE preserved_versions AS SELECT * FROM product_template_versions;
${seed}
${seed}
DO $test$ BEGIN
 IF (SELECT count(*) FROM product_templates) <> 4 OR (SELECT count(*) FROM product_template_versions) <> 3 THEN RAISE EXCEPTION 'Collision duplicated or repaired an existing model'; END IF;
 IF EXISTS (SELECT * FROM preserved_templates EXCEPT SELECT * FROM product_templates) OR EXISTS (SELECT * FROM preserved_versions EXCEPT SELECT * FROM product_template_versions) THEN RAISE EXCEPTION 'Collision overwrote original'; END IF;
END $test$;`);
}));
test('SQL load rolls back every new model if a version insert fails', sqlOptions, () => withPostgres(run => {
  run(`${fixture}
ALTER TABLE product_template_versions ADD CHECK (configuration->>'name' <> 'Cerveja long neck');`);
  const failed = run(seed, false); assert.match(failed.stdout + failed.stderr, /check constraint/);
  run(`DO $test$ BEGIN
 IF EXISTS(SELECT 1 FROM product_templates) OR EXISTS(SELECT 1 FROM product_template_versions) THEN RAISE EXCEPTION 'Partial data survived rollback'; END IF;
END $test$;`);
}));

test('global copies use independent restaurant categories without changing template JSON', async () => {
  const h=harness(), before=JSON.stringify(h.originals),slug=h.originals[0].slug;
  const a=await h.creator.execute({restaurantId:'A',templateSlug:slug,category:' Refrigerantes '});
  const b=await h.creator.execute({restaurantId:'B',templateSlug:slug,category:'Bebidas'});
  const legacy=await h.creator.execute({restaurantId:'A',templateSlug:slug});
  assert.equal(a.product.category,'Refrigerantes');assert.equal(b.product.category,'Bebidas');
  assert.equal(legacy.product.category,null);assert.notEqual(a.product.id,b.product.id);
  assert.equal(JSON.stringify(h.originals),before);
  await assert.rejects(h.creator.execute({restaurantId:'A',templateSlug:slug,category:42}),e=>e.status===400);
  assert.equal(JSON.stringify(h.originals),before);
});
