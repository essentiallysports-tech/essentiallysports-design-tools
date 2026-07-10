import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../dashboard-data.js', import.meta.url), 'utf8');
const store = new Map();
const calls = [];
const profile = {
  email: 'designteam@essentiallysports.com',
  name: 'Design Team',
  role: 'Associate',
  updated_at: new Date().toISOString(),
};

function query(name) {
  const queryObject = {
    update(payload) {
      calls.push({ name, method: 'update', payload });
      return queryObject;
    },
    eq(field, value) {
      calls.push({ name, method: 'eq', field, value });
      return queryObject;
    },
    select() {
      return queryObject;
    },
    single() {
      const payload = calls.findLast(call => call.name === name && call.method === 'update')?.payload || {};
      return Promise.resolve({ data: { ...profile, ...payload }, error: null });
    },
    then(resolve, reject) {
      return Promise.resolve({ error: null }).then(resolve, reject);
    },
  };
  return queryObject;
}

const documentMock = {
  readyState: 'complete',
  querySelectorAll: () => [],
  body: { dataset: {} },
  addEventListener: () => {},
};

const windowMock = {
  localStorage: {
    getItem(key) {
      return store.get(key) || null;
    },
    setItem(key, value) {
      store.set(key, value);
    },
  },
  dispatchEvent: () => {},
  addEventListener: () => {},
  CustomEvent: class {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  },
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  ESAuth: {
    getSession: async () => ({
      token: 'test-token',
      user: {
        email: 'suhail.quraishi@essentiallysports.com',
        name: 'Suhail Quraishi',
      },
    }),
    getSupabaseClient: () => ({
      rpc: async () => ({
        error: {
          message: 'Could not find the function public.set_es_designer_access_role(target_email, target_role) in the schema cache',
        },
      }),
      from: name => query(name),
    }),
  },
};

vm.runInNewContext(source, {
  window: windowMock,
  document: documentMock,
  Date,
  Math,
  Promise,
  Intl,
  URL,
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
});

const result = await windowMock.ESDashboardData.updatePersonAccessRole(
  'designteam@essentiallysports.com',
  'Admin',
);

if (result?.role !== 'Admin') throw new Error('Legacy role fallback did not return the updated role.');
if (!calls.some(call => call.name === 'es_designer_profiles' && call.method === 'update' && call.payload.role === 'Admin')) {
  throw new Error('Legacy role update was not attempted.');
}

console.log('Legacy Supabase role fallback test passed.');
