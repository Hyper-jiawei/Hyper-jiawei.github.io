export const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
export const monthOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
export function shiftMonth(month, offset) {
  const [y, m] = month.split('-').map(Number);
  return monthOf(new Date(y, m - 1 + offset, 1));
}
export const payDate = month => `${shiftMonth(month, 1)}-25`;
export const salaryMonth = (today = new Date()) => shiftMonth(monthOf(today), -1);
export const money = n => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
export const monthLabel = month => new Date(`${month}-01T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
export function taxLiability(n) {
  const bands = [[36000, .03, 0], [144000, .1, 2520], [300000, .2, 16920], [420000, .25, 31920], [660000, .3, 52920], [960000, .35, 85920], [Infinity, .45, 181920]];
  const [, rate, deduction] = bands.find(([ceiling]) => n <= ceiling);
  return round(Math.max(0, n * rate - deduction));
}
export function emptyState(today = new Date()) {
  return { '0': 1, '1': { '0': 0, '1': 0, '2': 1, '3': 0, '4': 0, '5': 0, '6': 100, '7': 0, '8': 10.5, '9': 0, '10': 0, '11': 0, '12': 0, '13': 0, '14': 0, '15': 1, '16': salaryMonth(today), '17': '' }, '2': {}, '3': [] };
}
const present = (o, k) => o[k] !== undefined && o[k] !== null && o[k] !== '';
export function compute(state, today = new Date()) {
  validateState(state);
  const cfg = state['1'], saved = state['2'], current = salaryMonth(today);
  const start = cfg['16'], keys = Object.keys(saved).sort();
  const first = keys.length && keys[0] < start ? keys[0] : start;
  const last = shiftMonth(current, 36), initialTaxYear = payDate(first).slice(0, 4);
  let income = 0, social = 0, paidTax = 0, count = 0, year = '', previousCNY = cfg['0'], previousHKD = cfg['1'];
  const rows = [];
  for (let month = first; month <= last; month = shiftMonth(month, 1)) {
    const entry = saved[month] || {}, date = payDate(month), payYear = date.slice(0, 4);
    if (payYear !== year) { year = payYear; income = social = paidTax = count = 0; }
    const eligible = payYear !== initialTaxYear || Number(date.slice(5, 7)) >= cfg['15'];
    if (eligible) count++;
    const get = (key, fallback) => present(entry, key) ? entry[key] : fallback;
    const performance = get('1', cfg['17'] && month < cfg['17'] ? 100 : cfg['6']);
    const gross = get('0', round(cfg['4'] + cfg['5'] * performance / 100));
    const contributions = get('2', round(cfg['7'] * cfg['8'] / 100 + cfg['9']));
    if (eligible) { income += gross; social += contributions; }
    const taxable = Math.max(0, income - social - 5000 * count - cfg['14'] * count);
    const tax = get('3', eligible ? Math.max(0, round(taxLiability(taxable) - paidTax)) : 0);
    if (eligible) paidTax = round(paidTax + tax);
    const net = get('4', round(gross - contributions - tax - cfg['13']));
    const meal = get('5', cfg['12']), living = get('6', cfg['10']), travel = get('7', cfg['11']);
    const fx = get('10', cfg['2']), historical = month < start;
    const preCNY = get('8', previousCNY), preHKD = get('9', previousHKD);
    const reconciled = !historical && month !== start && (present(entry, '8') || present(entry, '9'));
    const deviation = reconciled ? round(preCNY - previousCNY + (preHKD - previousHKD) * fx) : null;
    const available = round(net + meal), savings = round(available - living - travel);
    const endCNY = historical ? previousCNY : round(preCNY + savings);
    const endHKD = historical ? previousHKD : preHKD;
    const row = { month, date, gross, performance, contributions, taxable, tax, net, meal, living, travel, fx, preCNY, preHKD, deviation, overspending: deviation === null ? null : Math.max(0, -deviation), available, savings, endCNY, endHKD, total: round(endCNY + endHKD * fx), historical, confirmed: entry['11'] === true, published: entry['12'] === true };
    rows.push(row);
    if (!historical) { previousCNY = endCNY; previousHKD = endHKD; }
  }
  const forecast = rows.filter(row => row.month > current);
  return { rows, forecast, current: rows.find(row => row.month === current), final: forecast.at(-1), target: cfg['3'] };
}
export function bankTotals(state, month) {
  const totals = { CNY: 0, HKD: 0 };
  for (const card of state['3']) {
    if (present(card['4'], month)) totals[card['3']] += card['4'][month] * (card['2'] === 'c' ? -1 : 1);
  }
  return { CNY: round(totals.CNY), HKD: round(totals.HKD) };
}
export function confirmMonth(state, month, today = new Date()) {
  if (month > salaryMonth(today)) throw new Error('Future months cannot be submitted.');
  const row = compute(state, today).rows.find(r => r.month === month);
  if (!row) throw new Error('Month is outside the plan.');
  state['2'][month] = { '0': row.gross, '1': row.performance, '2': row.contributions, '3': row.tax, '4': row.net, '5': row.meal, '6': row.living, '7': row.travel, '8': row.preCNY, '9': row.preHKD, '10': row.fx, '11': true, '12': false };
}
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function monthValid(month) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && +month.slice(0, 4) >= 2000 && +month.slice(0, 4) <= 2100; }
function numeric(value) { return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e12; }
export function validateState(s) {
  const fail = () => { throw new Error('Invalid data file.'); };
  if (!object(s) || s['0'] !== 1 || Object.keys(s).some(k => !['0', '1', '2', '3'].includes(k)) || !object(s['1']) || !object(s['2']) || !Array.isArray(s['3'])) fail();
  const c = s['1'];
  if (Object.keys(c).length !== 18 || Object.keys(c).some(k => !/^(?:[0-9]|1[0-7])$/.test(k))) fail();
  for (let i = 0; i <= 15; i++) if (!numeric(c[i])) fail();
  if (c['2'] <= 0 || c['6'] < 0 || c['6'] > 200 || c['8'] < 0 || c['8'] > 100 || !Number.isInteger(c['15']) || c['15'] < 1 || c['15'] > 12 || !monthValid(c['16']) || !(c['17'] === '' || monthValid(c['17']))) fail();
  if (Object.keys(s['2']).length > 1200 || s['3'].length > 100) fail();
  for (const [month, entry] of Object.entries(s['2'])) {
    if (!monthValid(month) || !object(entry)) fail();
    for (const [k, value] of Object.entries(entry)) {
      if (!/^(?:[0-9]|1[0-2])$/.test(k)) fail();
      if (+k <= 10 && !numeric(value)) fail();
      if (+k >= 11 && typeof value !== 'boolean') fail();
      if (k === '10' && value <= 0) fail();
      if (k === '1' && (value < 0 || value > 200)) fail();
    }
    if (entry['12'] && !entry['11']) fail();
  }
  const ids = new Set();
  for (const card of s['3']) {
    if (!object(card) || Object.keys(card).length !== 5 || Object.keys(card).some(k => !/^[0-4]$/.test(k)) || typeof card['0'] !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(card['0']) || ids.has(card['0']) || typeof card['1'] !== 'string' || !/^[A-Za-z0-9 ._-]{1,32}$/.test(card['1']) || !['d', 'c'].includes(card['2']) || !['CNY', 'HKD'].includes(card['3']) || !object(card['4'])) fail();
    ids.add(card['0']);
    for (const [month, balance] of Object.entries(card['4'])) if (!monthValid(month) || !numeric(balance) || (card['2'] === 'c' && balance < 0)) fail();
  }
  return s;
}
export function importV2(text, today = new Date()) {
  if (text.length > 2_000_000) throw new Error('File is too large.');
  const match = text.match(/\/\*DATA\*\/([\s\S]*?)\/\*END\*\//);
  if (!match) return validateState(JSON.parse(text));
  const old = JSON.parse(match[1]), state = emptyState(today), cfg = old.cfg;
  if (!object(cfg) || !object(old.user) || !Array.isArray(old.confirmed)) throw new Error('Invalid V2 file.');
  const mapping = { curAssets: '0', target: '3', base: '4', perfBase: '5', perf: '6', living: '10', travel: '11', meal: '12', other: '13', special: '14' };
  for (const [name, key] of Object.entries(mapping)) if (cfg[name] !== undefined) state['1'][key] = Number(cfg[name]);
  state['1']['7'] = 0; state['1']['8'] = 0; state['1']['9'] = 0;
  const first = text.match(/\bFIRST\s*=\s*['"](\d{4}-\d{2})['"]/);
  const probation = text.match(/\bPROB\s*=\s*['"](\d{4}-\d{2})['"]/);
  state['1']['16'] = first ? first[1] : salaryMonth(today);
  state['1']['17'] = probation ? probation[1] : '';
  const known = text.match(/\bKNOWN\s*=\s*(\{[\s\S]*?\});/);
  const fieldMap = { gross: '0', perf: '1', social: '2', tax: '3', net: '4', meal: '5', living: '6', travel: '7', actual: '8' };
  if (known) {
    for (const row of known[1].matchAll(/['"](\d{4}-\d{2})['"]\s*:\s*\{([^{}]*)\}/g)) {
      const entry = { '11': true, '12': false };
      for (const field of row[2].matchAll(/([a-zA-Z]+)\s*:\s*(-?\d+(?:\.\d+)?)/g)) if (fieldMap[field[1]]) entry[fieldMap[field[1]]] = Number(field[2]);
      state['2'][row[1]] = entry;
    }
  }
  const historical = Object.entries(state['2']).sort().at(-1)?.[1];
  if (historical?.['2'] !== undefined) state['1']['9'] = historical['2'];
  for (const [month, data] of Object.entries(old.user)) {
    const entry = state['2'][month] || {};
    for (const [name, value] of Object.entries(data)) if (fieldMap[name] && value !== '' && value !== null) entry[fieldMap[name]] = Number(value);
    entry['11'] = old.confirmed.includes(month) || entry['11'] === true;
    entry['12'] = false; state['2'][month] = entry;
  }
  const computed = compute(state, today);
  for (const row of computed.rows) if (state['2'][row.month]?.['11'] && !row.historical) confirmMonth(state, row.month, today);
  return validateState(state);
}
