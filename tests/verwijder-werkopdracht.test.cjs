const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const html = readFileSync(process.env.INDEX_HTML_PATH || join(__dirname, '..', 'index.html'), 'utf8');
function between(start, end) {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Source boundaries: ${start}`);
  return html.slice(from, to);
}
const sbSource = between('async function sb(', 'const KOP_FIELDS');
const rightsSource = between('const VOLLEDIGE_RECHTEN', 'function heeftControleRechten');
const deleteSource = between('  async function verwijderWerkopdracht(', '  async function voegKlustypeToe(');
const tables = ['cilinderkop_rapporten', 'zuiger_rapporten', 'drijfstang_rapporten', 'krukas_rapporten', 'component_rapporten'];
const readPath = 'werkorders?werkopdracht_id=eq.wop-test&select=id';
const orderDelete = 'werkorders?werkopdracht_id=eq.wop-test';
const parentDelete = 'werkopdrachten?id=eq.wop-test';
const reportPaths = ['wo-a', 'wo-b'].flatMap(id => tables.map(t => `${t}?werkorder_id=eq.${id}`));
const sequence = [readPath, ...reportPaths, orderDelete, parentDelete];

// Only the actual sb(), rights check and deletion handler are evaluated.
// No application startup, CDN code, credentials or real fetch is used.
function harness({ name = 'Leroy', ids = [{ id: 'wo-a' }, { id: 'wo-b' }], failAt = -1, failure = 'http', gate } = {}) {
  const calls = [], deleted = [], errors = [];
  let refreshes = 0;
  const lock = { current: false };
  const context = vm.createContext({
    SUPABASE_URL: 'https://database.invalid', SUPABASE_KEY: 'test-only',
    monteurNaam: name, werkopdrachtVerwijderen: lock,
    setLoadError: error => errors.push(error),
    loadOverzicht: () => { refreshes++; },
    confirm: () => { throw new Error('Unexpected confirmation'); },
    prompt: () => { throw new Error('Unexpected prompt'); },
    fetch: async (url, options) => {
      assert.ok(url.startsWith('https://database.invalid/rest/v1/'));
      const path = url.split('/rest/v1/')[1];
      const index = calls.length;
      calls.push({ path, method: options.method || 'GET', prefer: options.headers.Prefer });
      if (gate) await gate(index);
      if (index === failAt) {
        if (failure === 'network') throw new Error('Simulated connection failure');
        if (failure === 'lost-response') {
          deleted.push(path);
          throw new Error('Simulated lost response after commit');
        }
        return { ok: false, status: 503, text: async () => 'Simulated database failure' };
      }
      if (options.method === 'DELETE') deleted.push(path);
      return { ok: true, text: async () => options.method === 'DELETE' ? '' : JSON.stringify(ids) };
    }
  });
  vm.runInContext(sbSource + rightsSource + deleteSource, context);
  return {
    run: () => context.verwijderWerkopdracht({ id: 'wop-test' }),
    calls, deleted, errors, lock,
    get refreshes() { return refreshes; }
  };
}

test('all inline scripts parse', () => {
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
});

for (const name of ['Leroy', 'Daan', 'Brito', 'Frank Verschaick', 'Frank van Schaick']) {
  test(`authorized direct deletion: ${name}`, async () => {
    const h = harness({ name });
    await h.run();
    assert.deepEqual(h.calls.map(c => c.path), sequence);
    assert.deepEqual(h.deleted, sequence.slice(1));
    assert.equal(h.calls[0].method, 'GET');
    assert.ok(h.calls.slice(1).every(c => c.method === 'DELETE' && c.prefer === 'return=minimal'));
    assert.deepEqual(h.errors, ['']);
    assert.equal(h.refreshes, 1);
    assert.equal(h.lock.current, false);
  });
}
for (const name of ['Wesley', 'Frank', 'Marvin', '']) {
  test(`unauthorized user makes no database calls: ${name}`, async () => {
    const h = harness({ name });
    await h.run();
    assert.equal(h.calls.length, 0);
    assert.equal(h.refreshes, 0);
    assert.match(h.errors.at(-1), /kan werkopdrachten verwijderen/);
  });
}

for (const failure of ['http', 'network']) {
  for (let failAt = 0; failAt < sequence.length; failAt++) {
    test(`${failure} error at ${sequence[failAt]} stops all subsequent requests`, async () => {
      const h = harness({ failAt, failure });
      await h.run();
      assert.deepEqual(h.calls.map(c => c.path), sequence.slice(0, failAt + 1));
      assert.deepEqual(h.deleted, sequence.slice(1, Math.max(1, failAt)));
      assert.equal(h.refreshes, 0);
      assert.equal(h.lock.current, false);
      assert.match(h.errors.at(-1), /Verwijderen van werkopdracht gestopt/);
      assert.match(h.errors.at(-1), failure === 'http' ? /503 Simulated database failure/ : /Simulated connection failure/);
      if (failAt > 0) assert.match(h.errors.at(-1), /Mogelijk zijn al gegevens verwijderd/);
      if (failAt > 0 && failAt <= reportPaths.length) {
        assert.match(h.errors.at(-1), new RegExp(tables[(failAt - 1) % tables.length]));
        assert.ok(!h.deleted.includes(orderDelete) && !h.deleted.includes(parentDelete));
      }
    });
  }
}

test('lost response after a report commit stops parents and warns of partial deletion', async () => {
  const h = harness({ failAt: 2, failure: 'lost-response' });
  await h.run();
  assert.deepEqual(h.deleted, reportPaths.slice(0, 2));
  assert.equal(h.calls.length, 3);
  assert.match(h.errors.at(-1), /Mogelijk zijn al gegevens verwijderd/);
  assert.equal(h.refreshes, 0);
});

for (const ids of [[], null]) {
  test(`empty workorder result ${JSON.stringify(ids)} deletes only parents`, async () => {
    const h = harness({ ids });
    await h.run();
    assert.deepEqual(h.calls.map(c => c.path), [readPath, orderDelete, parentDelete]);
    assert.equal(h.refreshes, 1);
  });
}

test('concurrent clicks issue one deletion; lock is released after success', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const h = harness({ gate: index => index === 0 ? pending : undefined });
  const first = h.run();
  await h.run();
  assert.equal(h.calls.length, 1);
  release();
  await first;
  assert.equal(h.calls.length, sequence.length);
  await h.run();
  assert.equal(h.calls.length, sequence.length * 2);
});

test('retry after failure starts a new attempt and clears stale error', async () => {
  const h = harness({ failAt: 1 });
  await h.run();
  assert.equal(h.calls.length, 2);
  await h.run();
  assert.deepEqual(h.calls.slice(2).map(c => c.path), sequence);
  assert.equal(h.errors.at(-1), '');
  assert.equal(h.refreshes, 1);
});
