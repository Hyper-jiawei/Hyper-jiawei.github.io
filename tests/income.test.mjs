import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { emptyState, compute, confirmMonth, bankTotals, taxLiability, validateState, importV2, payDate } from '../public/income/model.mjs';
import { deriveKey, seal, open, encode, passkeyJSON } from '../public/income/vault.mjs';
const today = new Date(2026, 10, 25);
function fixture() {
  const s = emptyState(today);
  Object.assign(s['1'], { '0': 1000, '1': 100, '2': .9, '4': 10000, '7': 5000, '8': 10, '9': 200, '10': 2000, '11': 500, '12': 200 });
  return s;
}
test('salary is paid on the following month 25 and forecast has 36 complete cycles', () => {
  assert.equal(payDate('2026-12'), '2027-01-25');
  const r = compute(fixture(), today);
  assert.equal(r.forecast.length, 36);
  assert.equal(r.forecast[0].month, '2026-11');
  assert.equal(r.final.date, '2029-11-25');
  assert.equal(r.final.living, 2000);
});
test('progressive tax bands include the full table', () => {
  assert.equal(taxLiability(0), 0);
  assert.equal(taxLiability(36000), 1080);
  assert.equal(taxLiability(144000), 11880);
  assert.equal(taxLiability(300000), 43080);
  assert.equal(taxLiability(420000), 73080);
  assert.equal(taxLiability(660000), 145080);
  assert.equal(taxLiability(960000), 250080);
  assert.equal(taxLiability(1000000), 268080);
});
test('salary, social contributions, tax, meal and allocation reconcile', () => {
  const row = compute(fixture(), today).current;
  assert.equal(row.contributions, 700);
  assert.equal(row.tax, 129);
  assert.equal(row.net, 9171);
  assert.equal(row.available, 9371);
  assert.equal(row.savings, 6871);
  assert.equal(row.endCNY, 7871);
  assert.equal(row.endHKD, 100);
  assert.equal(row.total, 7961);
});
test('tax resets in January of the pay year, not the salary year', () => {
  const s = fixture();
  s['2']['2026-11'] = { '0': 100000, '3': 1000 };
  const rows = compute(s, today).rows;
  assert.equal(rows.find(r => r.month === '2026-12').tax, 129);
});
test('first tax month applies only to the first pay year', () => {
  const s = fixture(); s['1']['15'] = 11;
  const rows = compute(s, today).rows;
  assert.equal(rows.find(r => r.month === '2026-12').tax, 129);
  assert.equal(rows.find(r => r.month === '2027-01').tax, 129);
});
test('confirmed real tax and net overrides remain authoritative', () => {
  const s = fixture(); s['2']['2026-10'] = { '3': 0, '4': 0 };
  assert.equal(compute(s, today).current.tax, 0);
  assert.equal(compute(s, today).current.net, 0);
  confirmMonth(s, '2026-10', today); s['1']['4'] = 12000;
  assert.equal(compute(s, today).current.gross, 10000);
  assert.equal(compute(s, today).current.net, 0);
  assert.equal(s['2']['2026-10']['11'], true);
  assert.equal(s['2']['2026-10']['12'], false);
  assert.throws(() => confirmMonth(s, '2026-11', today));
});
test('overspending values both currencies at the same current rate and respects zero', () => {
  const s = fixture(), first = compute(s, today).current;
  s['2']['2026-11'] = { '8': first.endCNY - 20, '9': 90, '10': 1.1 };
  const next = compute(s, today).rows.find(r => r.month === '2026-11');
  assert.equal(next.overspending, 31);
  s['2']['2026-11']['8'] = 0;
  assert.equal(compute(s, today).rows.find(r => r.month === '2026-11').preCNY, 0);
});
test('FX movement alone is not overspending', () => {
  const s = fixture(), first = compute(s, today).current;
  s['2']['2026-11'] = { '8': first.endCNY, '9': first.endHKD, '10': 1.2 };
  assert.equal(compute(s, today).rows.find(r => r.month === '2026-11').overspending, 0);
});
test('bank totals deduct credit liabilities and do not reuse older snapshots', () => {
  const s = fixture();
  s['3'] = [{ '0': 'a', '1': 'Debit', '2': 'd', '3': 'CNY', '4': { '2026-11': 1000 } }, { '0': 'b', '1': 'Credit', '2': 'c', '3': 'CNY', '4': { '2026-11': 200 } }, { '0': 'c', '1': 'HKD', '2': 'd', '3': 'HKD', '4': { '2026-11': 300 } }];
  assert.deepEqual(bankTotals(s, '2026-11'), { CNY: 800, HKD: 300 });
  assert.deepEqual(bankTotals(s, '2026-12'), { CNY: 0, HKD: 0 });
});
test('data rejects injection, unknown fields, non-finite amounts and invalid currencies', () => {
  const s = fixture(); s['1']['2'] = 0; assert.throws(() => validateState(s));
  s['1']['2'] = 1; s['2']['2026-10'] = { '0': Infinity }; assert.throws(() => validateState(s));
  delete s['2']['2026-10']; s['2']['2026-99'] = {}; assert.throws(() => validateState(s));
  delete s['2']['2026-99']; s['3'] = [{ '0': 'a', '1': '<script>', '2': 'd', '3': 'CNY', '4': {} }]; assert.throws(() => validateState(s));
  s['3'][0]['1'] = 'Card'; s['3'][0]['3'] = 'USD'; assert.throws(() => validateState(s));
});
test('V2 import reads data, never executes HTML, and preserves actual values', () => {
  const html = `const EMBEDDED=/*DATA*/${JSON.stringify({ cfg: { curAssets: 1000, base: 10000, perfBase: 1000, perf: 70 }, confirmed: [], user: { '2026-10': { meal: '200', net: '9000', living: '2000', travel: '500' } } })}/*END*/; const KNOWN={'2026-09':{gross:10000,social:700,tax:120,net:9180,meal:200,perf:100}}; const FIRST='2026-10',PROB='2027-01'; globalThis.importExecuted=true;`;
  const s = importV2(html, today);
  assert.equal(s['1']['0'], 1000); assert.equal(s['2']['2026-10']['4'], 9000);
  assert.equal(s['1']['9'], 700); assert.equal(s['2']['2026-09']['0'], 10000);
  assert.equal(globalThis.importExecuted, undefined);
  assert.equal(compute(s, today).current.net, 9000);
});
test('AES-GCM data is authenticated, opaque and bound to the passkey secret', async () => {
  const salt = encode(crypto.getRandomValues(new Uint8Array(32)));
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const key = await deriveKey(secret, salt), box = await seal(fixture(), key);
  assert.deepEqual(Object.keys(box), ['0', '1', '2']);
  assert.deepEqual(await open(box, key), fixture());
  assert.equal(JSON.stringify(box).includes('10000'), false);
  const wrong = await deriveKey(crypto.getRandomValues(new Uint8Array(32)), salt);
  await assert.rejects(open(box, wrong));
  box['1'] = encode(new Uint8Array(12)); await assert.rejects(open(box, key));
  await assert.rejects(crypto.subtle.exportKey('raw', key));
});
test('Passkey serialization does not send its encryption secret to the server', () => {
  const raw = new Uint8Array(32).buffer;
  const serialized = passkeyJSON({ id: 'id', rawId: raw, type: 'public-key', authenticatorAttachment: 'platform', getClientExtensionResults: () => ({ prf: { results: { first: raw } } }), response: { clientDataJSON: raw, authenticatorData: raw, signature: raw, userHandle: null } });
  assert.deepEqual(serialized.clientExtensionResults, {});
  assert.equal(JSON.stringify(serialized).includes('prf'), false);
});
test('production assets contain no persistence, demo bypass or embedded finance values', async () => {
  const app = await readFile(new URL('../public/income/app.mjs', import.meta.url), 'utf8');
  assert.equal(/localStorage|sessionStorage|indexedDB|EMBEDDED|KNOWN/.test(app), false);
  assert.equal(/\?demo|demo=true|demoMode/.test(app), false);
  const config = JSON.parse(await readFile(new URL('../public/income/config.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(config), ['service']);
  assert.equal(typeof config.service, 'string');
  if (config.service) {
    const url = new URL(config.service);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.origin, config.service);
  }
});
