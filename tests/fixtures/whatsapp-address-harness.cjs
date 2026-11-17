require('ts-node/register');
const assert = require('node:assert/strict');
const { CustomerAddressService } = require('../../src/service/clients/CustomerAddressService');
const { addressLimitsFromColumns } = require('../../src/security/customerAddress');
const { normalizeCustomerPhone } = require('../../src/security/customerPhone');
const fields = ['street', 'number', 'neighborhood', 'city', 'complement'];
const complete = { street: 'Rua das Flores', number: '12A', neighborhood: 'Centro', city: 'Cidade Teste', complement: null };
const empty = Object.fromEntries(fields.map(field => [field, null]));
function metadata(overrides = {}) {
  return fields.map(column_name => ({ column_name, data_type: 'text', character_maximum_length: null,
    is_nullable: 'YES', is_generated: 'NEVER', is_identity: 'NO', ...(overrides[column_name] || {}) }));
}
const limits = addressLimitsFromColumns(metadata());
const stubGateway = () => ({
  load: async () => ({ kind: 'loaded', address: { ...complete }, limits }),
  save: async (_owner, _expected, address) => ({ kind: 'saved', address: { ...address } }),
});
function harness(options = {}) {
  const rows = (options.records || [{ id: 'customer-A', restaurant_id: 'A', phone: '+5577999999999', ...empty }]).map(row => ({ ...row }));
  const calls = [], releases = [], locks = new Map();
  const columns = metadata(options.columns);
  const regions = options.regions || [...new Set(rows.map(row => row.restaurant_id))].flatMap(restaurant => [
    { id: '00000000-0000-4000-8000-000000000501', bairro: 'Vila Nova', frete: '5.00', lanchonete_id: restaurant },
    { id: '00000000-0000-4000-8000-000000000502', bairro: 'Centro', frete: '5.00', lanchonete_id: restaurant },
    { id: '00000000-0000-4000-8000-000000000503', bairro: 'Santa Cruz', frete: '5.00', lanchonete_id: restaurant },
  ]);
  const pool = { async connect() {
    if (options.connectError) throw new Error('secret connection error');
    let pending, unlock;
    const client = {
      async query(sql, params = []) {
        calls.push({ sql, params: Array.from(params) });
        if (sql.startsWith('BEGIN') || sql.startsWith('SET LOCAL')) return { rows: [] };
        if (sql.includes('FROM public.customers WHERE id = $1 AND restaurant_id = $2 FOR')) {
          assert.match(sql, /FOR (SHARE|UPDATE)$/);
          const key = JSON.stringify(params), previous = locks.get(key) || Promise.resolve();
          let release; const current = new Promise(resolve => { release = resolve; });
          locks.set(key, previous.then(() => current)); await previous; unlock = release;
          const row = rows.find(row => row.id === params[0] && row.restaurant_id === params[1]);
          return { rows: row ? [{ id: row.id, restaurant_id: row.restaurant_id, ...Object.fromEntries(fields.map(field => [field, row[field] === null ? null : String(row[field])])) }] : [] };
        }
        if (sql.includes('FROM customers WHERE restaurant_id = $1')) {
          const [restaurant, phone, national] = params;
          return { rows: rows.filter(row => row.restaurant_id === restaurant &&
            (normalizeCustomerPhone(row.phone) === phone || (national && !row.phone.startsWith('+') && normalizeCustomerPhone(row.phone) === national))
          ).slice(0, 2).map(row => ({ id: row.id, restaurant_id: row.restaurant_id,
            international_format: row.phone.startsWith('+'), national_format: Boolean(national && !row.phone.startsWith('+')) })) };
        }
        if (sql.includes('FROM bairros WHERE')) {
          const key = value => value.replace(/^ +| +$/g, '').toLowerCase();
          return { rows: regions.filter(region => region.lanchonete_id === params[0]).map(region => ({ ...region,
            ...(params.length > 1 ? { matches_address: key(region.bairro) === key(params[1]) } : {}),
          })) };
        }
        if (sql.includes('information_schema.columns')) {
          if (options.metadataError) throw new Error('secret metadata error');
          return { rows: options.missingColumns ? [] : columns };
        }
        if (sql.startsWith('UPDATE public.customers SET')) {
          assert.match(sql, /WHERE id = \$6 AND restaurant_id = \$7/);
          assert.doesNotMatch(sql, /SET name|SET phone|SET restaurant_id|bairro_id|frete|orders/);
          if (options.updateError) throw new Error('secret update error');
          const row = rows.find(row => row.id === params[5] && row.restaurant_id === params[6]);
          if (!row) return { rows: [] };
          pending = { ...row, city: params[0], street: params[1], number: params[2], neighborhood: params[3], complement: params[4] };
          if (options.triggerChangesAddress) pending.street = 'Rua alterada por trigger';
          return { rows: [{ id: pending.id, restaurant_id: pending.restaurant_id, ...Object.fromEntries(fields.map(field => [field, pending[field]])) }] };
        }
        if (sql === 'COMMIT') {
          if (options.commitError) throw new Error('secret commit error');
          if (pending) Object.assign(rows.find(row => row.id === pending.id && row.restaurant_id === pending.restaurant_id), pending);
          pending = undefined; unlock?.(); unlock = undefined;
          return { rows: [] };
        }
        if (sql === 'ROLLBACK') {
          pending = undefined; unlock?.(); unlock = undefined;
          if (options.rollbackError) throw new Error('secret rollback error');
          return { rows: [] };
        }
        assert.fail('Unexpected query');
      },
      release(discard) { releases.push(discard); unlock?.(); },
    };
    return client;
  } };
  return { gateway: new CustomerAddressService(pool), rows, calls, releases, columns, regions };
}
const stubRegionCatalog = () => {
  const options = restaurant => ['Vila Nova', 'Centro', 'Santa Cruz'].map((bairro, index) => ({
    bairro_id: `00000000-0000-4000-8000-${String(501 + index).padStart(12, '0')}`, bairro, fee: '5.00', restaurant_id: restaurant, fulfillment_mode: 'DELIVERY',
  }));
  return {
    list: async restaurant => ({ kind: 'listed', options: options(restaurant) }),
    resolve: async (restaurant, id) => {
      const region = options(restaurant).find(region => region.bairro_id === id);
      return region ? { kind: 'found', region } : { kind: 'not_found', options: options(restaurant) };
    },
    lookup: async (restaurant, neighborhood) => ({ kind: 'found', region: options(restaurant).find(region => region.bairro === neighborhood) || { ...options(restaurant)[0], bairro: neighborhood } }),
  };
};
module.exports = { harness, complete, empty, limits, metadata, stubGateway, stubRegionCatalog };
