// A tiny in-memory stand-in for the PostgREST and Storage calls that
// netlify/functions/_merch-store.js makes. Used by scripts/test-merch.mjs and
// scripts/test-merch-sales.mjs. Supports only what the store uses:
//   GET    ?select=&<col>=eq|neq|gte|is|ov.<v>&order=<col>.desc[.nullslast]&limit&offset
//   POST   ?on_conflict=<col> with Prefer resolution=ignore-duplicates | merge-duplicates
//   PATCH  ?<col>=eq.<v> (Prefer return=representation)
// Storage: GET /storage/v1/object/<bucket>/<path>, DELETE /storage/v1/object/<bucket>.
const reply = (status, body) => new Response(body == null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function createFakeDb() {
  const tables = new Map();
  const objects = new Map(); // "bucket/path" -> Buffer
  const calls = [];
  const table = name => { if (!tables.has(name)) tables.set(name, []); return tables.get(name); };
  let missing = false; // simulate "migration not run"

  const parseVal = v => (v === 'true' ? true : v === 'false' ? false : v === 'null' ? null : v);
  function filterRows(rows, params) {
    let out = rows.slice();
    for (const [k, raw] of params) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k)) continue;
      const dot = raw.indexOf('.');
      const op = raw.slice(0, dot); const val = raw.slice(dot + 1);
      out = out.filter(r => {
        const have = r[k];
        if (op === 'eq') return String(have) === val;
        if (op === 'neq') return String(have) !== val;
        if (op === 'gte') return String(have) >= val;
        if (op === 'is') return (have ?? null) === parseVal(val) || (parseVal(val) === false && !have);
        if (op === 'ov') { const want = val.replace(/^\{|\}$/g, '').split(',').map(s => s.replace(/^"|"$/g, '')); return Array.isArray(have) && have.some(x => want.includes(x)); }
        throw new Error(`fake db: op ${op}`);
      });
    }
    const order = params.get('order');
    if (order) {
      const [col, dir] = order.split('.');
      out.sort((a, b) => { const x = a[col] ?? ''; const y = b[col] ?? ''; return (x < y ? -1 : x > y ? 1 : 0) * (dir === 'desc' ? -1 : 1); });
    }
    const offset = Number(params.get('offset') || 0);
    const limit = params.has('limit') ? Number(params.get('limit')) : Infinity;
    return out.slice(offset, offset + limit);
  }
  const defaults = name => {
    const now = new Date().toISOString();
    if (name === 'frameup_merch_products') return { created_at: now, updated_at: now, state: 'HIDDEN', collection_ids: [], regions: [], images: [], variants: [], price: {} };
    if (name === 'frameup_merch_events') return { created_at: now, received_at: now, payload: {} };
    if (name === 'frameup_merch_orders') return { received_at: now, updated_at: now, lines: [], product_ids: [] };
    return { created_at: now };
  };

  async function handle(href, options = {}) {
    const url = new URL(href);
    const method = options.method || 'GET';
    calls.push({ method, href, body: options.body ? JSON.parse(options.body) : undefined, headers: options.headers || {} });
    if (url.pathname.startsWith('/storage/v1/object/')) {
      const rest = decodeURIComponent(url.pathname.slice('/storage/v1/object/'.length));
      if (method === 'GET') { const b = objects.get(rest); return b ? new Response(b, { status: 200, headers: { 'content-type': 'image/png' } }) : reply(400, { error: 'not_found', statusCode: '404' }); }
      if (method === 'DELETE') { const { prefixes } = JSON.parse(options.body); prefixes.forEach(p => objects.delete(`${rest}/${p}`)); return reply(200, []); }
    }
    const name = url.pathname.replace('/rest/v1/', '');
    if (missing) return reply(404, { code: 'PGRST205', message: `Could not find the table 'public.${name}'` });
    const rows = table(name);
    const prefer = String(options.headers?.Prefer || '');
    const wantRows = prefer.includes('return=representation');
    if (method === 'GET') return reply(200, filterRows(rows, url.searchParams));
    if (method === 'POST') {
      const body = JSON.parse(options.body);
      const list = Array.isArray(body) ? body : [body];
      const key = url.searchParams.get('on_conflict') || (name === 'frameup_merch_products' ? 'product_id' : name === 'frameup_merch_orders' ? 'order_id' : 'id');
      const inserted = [];
      for (const r of list) {
        const at = rows.findIndex(x => x[key] === r[key]);
        if (at >= 0) {
          if (prefer.includes('ignore-duplicates')) continue;
          if (prefer.includes('merge-duplicates')) { rows[at] = { ...rows[at], ...r }; inserted.push(rows[at]); continue; }
          return reply(409, { code: '23505', message: 'duplicate key' });
        }
        const row = { ...defaults(name), ...r };
        rows.push(row); inserted.push(row);
      }
      return wantRows ? reply(201, inserted) : new Response(null, { status: 201 });
    }
    if (method === 'PATCH') {
      const patch = JSON.parse(options.body);
      const hit = filterRows(rows, url.searchParams);
      hit.forEach(r => Object.assign(r, patch));
      return wantRows ? reply(200, hit) : new Response(null, { status: 204 });
    }
    throw new Error(`fake db: ${method} ${href}`);
  }
  return {
    handle, calls, tables, objects, table,
    setMissing(v) { missing = v; },
    reset() { tables.clear(); objects.clear(); calls.length = 0; missing = false; },
  };
}
