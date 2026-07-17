#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const dashboardSource = readFileSync(new URL('../dashboard-data.js', import.meta.url), 'utf8');

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

const writes = [];
const session = {
  token: 'verified-supabase-session',
  user: {
    email: 'designer@essentiallysports.com',
    name: 'Design User',
  },
};

const supabase = {
  from(table) {
    return {
      async upsert(row, options = {}) {
        writes.push({ table, row: structuredClone(row), options: structuredClone(options) });
        return { data: null, error: null };
      },
    };
  },
};

const localStorage = createStorage();
const documentElementClasses = new Set();
const window = {
  crypto: webcrypto,
  localStorage,
  location: { pathname: '/index.html', hash: '' },
  ESAuth: {
    async getSession() {
      return session;
    },
    getSupabaseClient() {
      return supabase;
    },
  },
  addEventListener() {},
  dispatchEvent() {},
  setTimeout() {},
  setInterval() {},
};

const context = vm.createContext({
  window,
  document: {
    readyState: 'complete',
    visibilityState: 'visible',
    documentElement: {
      classList: {
        toggle(name, enabled) {
          if (enabled) documentElementClasses.add(name);
          else documentElementClasses.delete(name);
        },
      },
    },
    querySelectorAll() {
      return [];
    },
    addEventListener() {},
  },
  CustomEvent: class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  },
  structuredClone,
  Date,
  Math,
  JSON,
  Object,
  Array,
  String,
  Boolean,
  Number,
  Map,
  Set,
  Promise,
});

vm.runInContext(dashboardSource, context, { filename: 'dashboard-data.js' });

const exported = await window.ESDashboardData.recordDesignExport({
  workspace: 'Social Media',
  workspaceVariant: 'Cover Image',
  title: 'Shared Export Test',
  filename: 'shared-export-test.jpeg',
  imageWidth: 1080,
  imageHeight: 1350,
});

const exportTaskWrite = writes.find(write => (
  write.table === 'es_designer_tasks'
  && write.row.source_id === exported.id
  && write.row.task_type === 'exported_design'
));
assert.ok(exportTaskWrite, 'an export must create a shared Supabase exported-design task');
assert.equal(exportTaskWrite.row.creator_email, session.user.email);
assert.equal(exportTaskWrite.row.filename, 'shared-export-test.jpeg');

const exportActivityWrite = writes.find(write => (
  write.table === 'es_designer_activity'
  && write.row.entity_id === exported.id
  && write.row.event_type === 'design_exported'
));
assert.ok(exportActivityWrite, 'an export must create a shared Supabase activity event');
assert.equal(exportActivityWrite.row.actor_email, session.user.email);

const request = await window.ESDashboardData.recordDesignRequest({
  id: 'DR-cloud-write-test',
  title: 'Shared Request Test',
  requestType: 'Newsletter Graphic',
  requester: {
    name: 'Design User',
    email: session.user.email,
  },
  status: 'New',
});

const requestTaskWrite = writes.find(write => (
  write.table === 'es_designer_tasks'
  && write.row.id === request.id
  && write.row.task_type === 'design_request'
));
assert.ok(requestTaskWrite, 'a design request must create a shared Supabase request task');
assert.equal(requestTaskWrite.row.creator_email, session.user.email);

const directActivity = await window.ESDashboardData.recordActivity({
  type: 'request_submitted',
  label: 'Submitted Shared Request Test',
  entityType: 'request',
  entityId: request.id,
});
assert.ok(
  writes.some(write => write.table === 'es_designer_activity' && write.row.id === directActivity.id),
  'request activity must be written to shared Supabase activity storage',
);

console.log('Dashboard shared Supabase write-path tests passed.');
