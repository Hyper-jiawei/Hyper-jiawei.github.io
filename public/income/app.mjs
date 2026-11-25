import { emptyState, compute, confirmMonth, validateState, importV2, bankTotals, monthOf, salaryMonth, monthLabel, money, round } from './model.mjs';
import { api, deriveKey, open, seal, passkeyJSON, creationOptions, requestOptions } from './vault.mjs';
const $ = id => document.getElementById(id);
const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let service = '', token = '', key = null, state = null, baseline = null, revision = null, dirty = false, publishing = false, epoch = 0;
let view = 'home', selected = salaryMonth(), bankMonth = monthOf(new Date()), lastActivity = 0, lastTouch = 0, hiddenAt = 0, toastTimer;
const fields = [['0', 'Gross Salary', 'gross'], ['1', 'Performance Rate', 'performance'], ['2', 'Social Insurance and Housing Fund', 'contributions'], ['3', 'Income Tax', 'tax'], ['4', 'Net Salary', 'net'], ['5', 'Meal Allowance', 'meal'], ['6', 'Living Budget', 'living'], ['7', 'Travel Budget', 'travel'], ['8', 'CNY Balance Before Record', 'preCNY'], ['9', 'HKD Balance Before Record', 'preHKD'], ['10', 'HKD to CNY Rate', 'fx']];
const configFields = [['0', 'Starting CNY Balance'], ['1', 'Starting HKD Balance'], ['2', 'HKD to CNY Rate'], ['3', 'Savings Goal'], ['4', 'Base Salary'], ['5', 'Performance Base'], ['6', 'Performance Rate'], ['7', 'Social Insurance Base'], ['8', 'Social Insurance Rate'], ['9', 'Housing Fund'], ['10', 'Living Budget'], ['11', 'Travel Budget'], ['12', 'Meal Allowance'], ['13', 'Other Deductions'], ['14', 'Additional Tax Deduction'], ['15', 'First Tax Month']];
function notify(message) {
  $('toast').textContent = message; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6500);
}
function status() {
  $('save-status').textContent = publishing ? 'Publishing' : dirty ? 'Unpublished changes' : 'Published';
  $('save-status').classList.toggle('dirty', dirty);
}
function markDirty() { dirty = true; status(); if ($('publish') && !publishing) $('publish').disabled = false; }
function failure(error) { if (error.status === 401) lock('Your session has expired. Sign in again.'); else notify(error.message || 'Something went wrong.'); }
function dialog(title, content, actions) {
  $('dialog-title').textContent = title; $('dialog-content').innerHTML = content; $('dialog-actions').replaceChildren();
  for (const [label, handler, primary = false, danger = false] of actions) {
    const button = document.createElement('button'); button.className = `button${primary ? ' primary' : ''}${danger ? ' danger' : ''}`; button.textContent = label;
    button.addEventListener('click', async () => { try { await handler(); } catch (error) { failure(error); } }); $('dialog-actions').append(button);
  }
  $('dialog').showModal();
}
function closeDialog() { if (!publishing) $('dialog').close(); }
function numericInput(id, label, value, disabled = false, attributes = '') {
  return `<label class="field"><span>${escape(label)}</span><input id="${id}" type="number" ${attributes.includes('step=') ? '' : 'step="any"'} value="${value}" ${disabled ? 'disabled' : ''} ${attributes}></label>`;
}
function readNumber(input) {
  if (input.value.trim() === '' || !input.checkValidity() || !Number.isFinite(input.valueAsNumber) || Math.abs(input.valueAsNumber) > 1e12) throw new Error('Enter a valid number.');
  return input.valueAsNumber;
}
function badge(row) { return `<span class="badge ${row.published ? 'published' : row.confirmed ? 'confirmed' : ''}">${row.published ? 'Published' : row.confirmed ? 'Confirmed' : row.month > salaryMonth() ? 'Forecast' : 'Draft'}</span>`; }
function stat(label, amount, meta = '') { return `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value">${amount}</div>${meta ? `<div class="stat-meta">${meta}</div>` : ''}</div>`; }
function head(title, tools = '', subline = '') { return `<button class="back" id="back">← Home</button><div class="page-title"><div><span class="eyebrow">YOUR PRIVATE LEDGER</span><h1>${title}</h1>${subline ? `<div class="subline">${subline}</div>` : ''}</div><div class="page-tools">${tools}</div></div>`; }
function home() {
  const result = compute(state), counts = Object.values(state['2']).filter(e => e['12']).length;
  const balances = state['3'].length ? bankTotals(state, bankMonth) : { CNY: state['1']['0'], HKD: state['1']['1'] };
  $('root').innerHTML = `<div class="page-title"><div><span class="eyebrow">MAKE ROOM FOR WHAT MATTERS</span><h1>Your money, in perspective.</h1><div class="subline">${monthLabel(monthOf(new Date()))}</div></div><div class="page-tools"><button class="button" id="plan">Plan</button><button class="button" id="import">Import V2</button>${dirty ? '<button class="button primary" id="publish">Publish</button>' : ''}</div></div><div class="summary">${stat('CNY Balance', money(balances.CNY))}${stat('HKD Balance', money(balances.HKD))}${stat('Three-Year Projection', money(result.final?.total || 0), 'CNY')}</div><div class="menu"><button class="menu-item" data-view="record"><span class="menu-num">01</span><div><h2>Record last month's salary payment</h2><p>${monthLabel(salaryMonth())}</p></div><span class="arrow">↗</span></button><button class="menu-item" data-view="submitted"><span class="menu-num">02</span><div><h2>Submitted Months</h2><p>${counts} ${counts === 1 ? 'month' : 'months'} published</p></div><span class="arrow">↗</span></button><button class="menu-item" data-view="cards"><span class="menu-num">03</span><div><h2>Bank Cards</h2><p>${state['3'].length} ${state['3'].length === 1 ? 'card' : 'cards'}</p></div><span class="arrow">↗</span></button></div>`;
  $('root').querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => { view = button.dataset.view; selected = salaryMonth(); render(); }));
  $('plan').onclick = showPlan; $('import').onclick = importFile; if ($('publish')) $('publish').onclick = () => publish().catch(failure);
}
function records() {
  const result = compute(state), months = result.rows.filter(r => r.month <= salaryMonth() && (view !== 'submitted' || r.published || baseline['2'][r.month]?.['12']));
  if (!months.some(r => r.month === selected)) selected = months.at(-1)?.month;
  $('root').innerHTML = head(view === 'record' ? 'Record Salary' : 'Submitted Months', '<button class="button" id="plan">Plan</button><button class="button primary" id="publish">Publish</button>') + (months.length ? `<div class="workspace"><nav class="month-list" aria-label="Salary months">${months.slice().reverse().map(row => `<button class="month-item ${row.month === selected ? 'selected' : ''}" data-month="${row.month}"><strong>${monthLabel(row.month)}</strong><small>${row.date}</small><small data-total="${row.month}">${money(row.available)} CNY</small><small>${badge(row)}</small></button>`).join('')}</nav><section class="panel" id="month-panel"></section></div>` : '<div class="empty"><h2>No submitted months yet</h2><p>Confirm a month and publish it to see it here.</p></div>') + (view === 'record' ? `<section id="forecast">${forecastHTML(result)}</section>` : '');
  $('back').onclick = goHome; $('plan').onclick = showPlan; $('publish').disabled = !dirty || publishing; $('publish').onclick = () => publish().catch(failure);
  $('root').querySelectorAll('[data-month]').forEach(button => button.addEventListener('click', () => { selected = button.dataset.month; render(); }));
  if (months.length) monthPanel(result.rows.find(r => r.month === selected));
}
function monthDerived(row) {
  return `<div class="totals-row"><div><span>Total Income</span><strong>${money(row.available)}</strong></div><div><span>Savings</span><strong class="${row.savings >= 0 ? 'positive' : 'negative'}">${money(row.savings)}</strong></div><div><span>Projected CNY Balance</span><strong>${money(row.endCNY)}</strong></div></div><div class="allocation">${[['living', row.living], ['travel', row.travel], ['savings', row.savings]].map(([type, value]) => `<span class="${type}" data-width="${Math.max(0, value) / Math.max(1, Math.max(0, row.living) + Math.max(0, row.travel) + Math.max(0, row.savings)) * 100}"></span>`).join('')}</div><div class="allocation-key"><span><i class="dot living"></i>Living</span><span><i class="dot travel"></i>Travel</span><span><i class="dot savings"></i>Savings</span></div>`;
}
function refreshCalculations() {
  const result = compute(state), row = result.rows.find(r => r.month === selected);
  fields.forEach(([id, , property]) => { $(`month-${id}`).value = row[property]; });
  $('overspending').value = row.overspending === null ? '—' : money(row.overspending);
  $('month-derived').innerHTML = monthDerived(row);
  $('month-derived').querySelectorAll('[data-width]').forEach(segment => { segment.style.width = `${segment.dataset.width}%`; });
  document.querySelectorAll('[data-total]').forEach(element => { element.textContent = `${money(result.rows.find(r => r.month === element.dataset.total).available)} CNY`; });
  if ($('forecast')) $('forecast').innerHTML = forecastHTML(result);
}
function monthPanel(row) {
  $('month-panel').innerHTML = `<div class="panel-head"><div><h2>${monthLabel(row.month)}</h2><small>Payday ${row.date}</small></div>${badge(row)}</div><div class="form-grid">${fields.map(([id, label, property]) => numericInput(`month-${id}`, label, row[property], row.confirmed, id === '1' ? 'min="0" max="200"' : id === '10' ? 'min="0.0001" step="0.0001"' : '')).join('')}<label class="field"><span>Overspending</span><input id="overspending" value="${row.overspending === null ? '—' : money(row.overspending)}" disabled></label></div><div id="month-derived">${monthDerived(row)}</div><div class="panel-actions">${!row.confirmed && state['3'].length ? '<button class="button" id="use-cards">Use Card Balances</button>' : ''}<button class="button ${row.confirmed ? '' : 'primary'}" id="confirm">${row.confirmed ? 'Edit' : 'Confirm'}</button></div>`;
  $('month-panel').querySelectorAll('[data-width]').forEach(segment => { segment.style.width = `${segment.dataset.width}%`; });
  fields.forEach(([id]) => {
    const input = $(`month-${id}`);
    input.addEventListener('change', () => {
      const entry = state['2'][selected] || {}, before = structuredClone(entry);
      try {
        const value = readNumber(input); entry[id] = value; entry['12'] = false; state['2'][selected] = entry;
        validateState(state); markDirty(); refreshCalculations();
      } catch (error) { state['2'][selected] = before; refreshCalculations(); failure(error); }
    });
  });
  $('confirm').onclick = () => {
    try {
      if (row.confirmed) { state['2'][selected]['11'] = false; state['2'][selected]['12'] = false; }
      else confirmMonth(state, selected);
      markDirty(); render();
    } catch (error) { failure(error); }
  };
  if ($('use-cards')) $('use-cards').onclick = () => {
    const totals = bankTotals(state, row.date.slice(0, 7));
    const missing = state['3'].some(card => card['4'][row.date.slice(0, 7)] === undefined);
    if (missing) { notify('Update every card balance for this payday first.'); return; }
    state['2'][selected] = { ...(state['2'][selected] || {}), '8': totals.CNY, '9': totals.HKD, '12': false }; markDirty(); render();
  };
}
function forecastHTML(result) {
  const values = result.forecast.map(row => row.total), low = Math.min(...values), high = Math.max(...values), span = high - low || 1;
  const points = values.map((value, index) => `${round(8 + index / Math.max(1, values.length - 1) * 984)},${round(160 - (value - low) / span * 135)}`).join(' ');
  return `<div class="section-head"><h2>The next three years</h2><span class="subline">Savings Goal ${money(result.target)} CNY</span></div><div class="chart"><svg viewBox="0 0 1000 180" role="img" aria-label="Projected assets over 36 months" preserveAspectRatio="none"><path d="M8 165 H992" stroke="#e3e0d8" fill="none"/><polyline points="${points}" stroke="#c3694e" stroke-width="3" fill="none" vector-effect="non-scaling-stroke"/></svg><div class="chart-labels"><span>${result.forecast[0]?.date || ''}</span><span>${result.final?.date || ''}</span></div></div><div class="table-wrap"><table><thead><tr>${['Salary Month', 'Payday', 'Gross Salary', 'Performance Rate', 'Social and Housing', 'Income Tax', 'Net Salary', 'Meal Allowance', 'Living Budget', 'Travel Budget', 'Savings', 'CNY Before Record', 'HKD Before Record', 'Overspending', 'Projected Assets'].map(label => `<th>${label}</th>`).join('')}</tr></thead><tbody>${result.forecast.map(row => `<tr><td>${monthLabel(row.month)}</td><td>${row.date}</td>${[row.gross, row.performance, row.contributions, row.tax, row.net, row.meal, row.living, row.travel, row.savings, row.preCNY, row.preHKD].map(n => `<td>${money(n)}</td>`).join('')}<td>${row.overspending === null ? '—' : money(row.overspending)}</td><td>${money(row.total)}</td></tr>`).join('')}</tbody></table></div>`;
}
function cards() {
  const totals = bankTotals(state, bankMonth);
  $('root').innerHTML = head('Bank Cards', '<button class="button" id="add-card">Add Card</button><button class="button primary" id="publish">Publish</button>') + `<div class="bank-month"><label for="bank-month">Balance Date</label><input id="bank-month" type="month" min="2000-01" max="2100-12" value="${bankMonth}"><span class="subline">${bankMonth}-25</span></div><div class="summary">${stat('Net CNY Balance', money(totals.CNY))}${stat('Net HKD Balance', money(totals.HKD))}${stat('Cards', state['3'].length)}</div>` + (state['3'].length ? `<div class="cards">${state['3'].map((card, index) => `<section class="bank-card"><div class="card-head"><div><h2>${escape(card['1'])}</h2><small>${card['2'] === 'c' ? 'Credit Card' : 'Debit Card'}</small></div><button class="button quiet danger" data-remove="${index}" aria-label="Delete ${escape(card['1'])}">×</button></div><div class="card-balance"><span>${card['3']}</span><strong>${card['4'][bankMonth] === undefined ? '—' : money(card['4'][bankMonth])}</strong></div>${numericInput(`card-${index}`, card['2'] === 'c' ? 'Amount Owed' : 'Account Balance', card['4'][bankMonth] ?? '', false, card['2'] === 'c' ? 'min="0"' : '')}</section>`).join('')}</div>` : '<div class="empty"><h2>Your cards, together.</h2><p>Add your first card to track its balance.</p></div>');
  $('back').onclick = goHome; $('add-card').onclick = addCard; $('publish').disabled = !dirty || publishing; $('publish').onclick = () => publish().catch(failure);
  $('bank-month').onchange = () => { if ($('bank-month').checkValidity() && $('bank-month').value) { bankMonth = $('bank-month').value; render(); } };
  state['3'].forEach((card, index) => $(`card-${index}`).onchange = event => {
    try { const value = readNumber(event.target); if (card['2'] === 'c' && value < 0) throw new Error('Amount owed cannot be negative.'); card['4'][bankMonth] = value; markDirty(); render(); }
    catch (error) { failure(error); }
  });
  $('root').querySelectorAll('[data-remove]').forEach(button => button.onclick = () => {
    const index = Number(button.dataset.remove);
    dialog('Delete Card', `<p class="dialog-message">${escape(state['3'][index]['1'])}</p>`, [['Keep Card', closeDialog], ['Delete', () => { state['3'].splice(index, 1); markDirty(); closeDialog(); render(); }, false, true]]);
  });
}
function addCard() {
  dialog('Add Card', '<div class="form-grid"><label class="field"><span>Card Name</span><input id="new-name" maxlength="32" pattern="[A-Za-z0-9 ._-]+" autocomplete="off"></label><label class="field"><span>Card Type</span><select id="new-type"><option value="d">Debit Card</option><option value="c">Credit Card</option></select></label><label class="field"><span>Currency</span><select id="new-currency"><option>CNY</option><option>HKD</option></select></label></div>', [['Cancel', closeDialog], ['Add Card', () => {
    const name = $('new-name').value.trim();
    if (!/^[A-Za-z0-9 ._-]{1,32}$/.test(name)) throw new Error('Use an English card name.');
    if (state['3'].length >= 100) throw new Error('Card limit reached.');
    state['3'].push({ '0': crypto.randomUUID(), '1': name, '2': $('new-type').value, '3': $('new-currency').value, '4': {} });
    markDirty(); closeDialog(); render();
  }, true]]);
  $('new-name').focus();
}
function showPlan() {
  dialog('Plan', `<div class="form-grid">${configFields.map(([id, label]) => numericInput(`cfg-${id}`, label, state['1'][id], false, id === '2' ? 'min="0.0001"' : id === '15' ? 'min="1" max="12" step="1"' : id === '6' ? 'min="0" max="200"' : id === '8' ? 'min="0" max="100"' : '')).join('')}<label class="field"><span>First Salary Month</span><input id="cfg-16" type="month" value="${state['1']['16']}" min="2000-01" max="${salaryMonth()}"></label><label class="field"><span>Performance Start Month</span><input id="cfg-17" type="month" value="${state['1']['17']}" min="2000-01" max="2100-12"></label></div>`, [['Cancel', closeDialog], ['Apply Plan', () => {
    const draft = structuredClone(state);
    configFields.forEach(([id]) => { draft['1'][id] = readNumber($(`cfg-${id}`)); });
    draft['1']['16'] = $('cfg-16').value; draft['1']['17'] = $('cfg-17').value;
    if (!$('cfg-16').checkValidity() || !$('cfg-16').value || !$('cfg-17').checkValidity()) throw new Error('Enter a valid month.');
    validateState(draft); compute(draft); state = draft; markDirty(); closeDialog(); render();
  }, true]]);
}
function importFile() {
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.html,.json';
  input.onchange = async () => {
    const file = input.files[0]; if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error('File is too large.');
      const guard = epoch, imported = importV2(await file.text());
      if (!state || guard !== epoch) return;
      dialog('Import V2', '<p class="dialog-message">Replace this ledger with the selected file?</p>', [['Cancel', closeDialog], ['Import', () => { state = imported; markDirty(); closeDialog(); render(); notify('Imported. Review the plan and publish your changes.'); }, true]]);
    } catch (error) { failure(error); }
  };
  input.click();
}
async function publish() {
  if (!dirty || publishing || !state || document.hidden) return false;
  const unconfirmed = Object.entries(state['2']).some(([month, entry]) => month <= salaryMonth() && !entry['11'] && JSON.stringify(entry) !== JSON.stringify(baseline['2'][month] || {}));
  if (unconfirmed) { notify('Confirm your edited months before publishing.'); return false; }
  const guard = epoch, before = JSON.stringify(state), snapshot = structuredClone(state), session = token, encryptionKey = key;
  for (const entry of Object.values(snapshot['2'])) if (entry['11']) entry['12'] = true;
  publishing = true; status(); if ($('publish')) $('publish').disabled = true;
  $('dialog').querySelectorAll('button').forEach(button => { button.disabled = true; });
  try {
    const box = await seal(snapshot, encryptionKey);
    if (guard !== epoch || !state || document.hidden) return false;
    const result = await api(service, '/vault', session, { revision, box }, 'PUT');
    if (guard !== epoch || !state) return false;
    revision = result.revision; baseline = snapshot;
    if (JSON.stringify(state) === before) {
      state = structuredClone(snapshot); dirty = false;
    } else {
      for (const [month, entry] of Object.entries(state['2'])) if (JSON.stringify({ ...entry, '12': true }) === JSON.stringify(snapshot['2'][month])) entry['12'] = true;
      dirty = JSON.stringify(state) !== JSON.stringify(baseline);
    }
    render(); notify('Published to your private repository.'); return true;
  } finally { if (guard === epoch) { publishing = false; status(); if ($('publish')) $('publish').disabled = !dirty; $('dialog').querySelectorAll('button').forEach(button => { button.disabled = false; }); } }
}
function goHome() {
  if (publishing) { notify('Wait for publishing to finish.'); return; }
  if (!dirty) { view = 'home'; render(); return; }
  dialog('Publish Changes', '<p class="dialog-message">You have unpublished changes.</p>', [['Stay', closeDialog], ['Discard Changes', () => { state = structuredClone(baseline); dirty = false; closeDialog(); view = 'home'; render(); }, false, true], ['Publish and Return', async () => { if (await publish()) { closeDialog(); view = 'home'; render(); } }, true]]);
}
function render() {
  if (!state || document.hidden) return;
  $('root').hidden = false; $('header-actions').hidden = false; status();
  if (view === 'home') home(); else if (view === 'cards') cards(); else records();
}
function loginScreen(message) {
  $('root').hidden = false; $('header-actions').hidden = true;
  $('root').innerHTML = '<section class="login"><span class="eyebrow">YOUR PRIVATE LEDGER</span><h1>A little clarity.<br>A lot of possibility.</h1><p>Income, spending, and what comes next.</p><button class="button primary" id="sign-in">Sign in with GitHub</button><div class="login-state" id="login-state" role="status"></div><div class="login-footer">GitHub identity <span>·</span> Passkey verification <span>·</span> Encrypted storage</div></section>';
  $('login-state').textContent = message; $('sign-in').disabled = !service;
  $('sign-in').onclick = () => { location.assign(`${service}/auth/start`); };
}
function lock(message = 'Locked. Sign in again to continue.') {
  const session = token;
  epoch++; token = ''; key = null; state = baseline = null; revision = null; dirty = false; publishing = false;
  $('dialog').close(); $('dialog-content').replaceChildren(); $('dialog-actions').replaceChildren(); $('toast').hidden = true;
  view = 'home'; loginScreen(message);
  if (session && service) api(service, '/session/logout', session, {}).catch(() => {});
}
async function unlock(ticket) {
  const guard = epoch;
  $('sign-in').disabled = true; $('login-state').textContent = 'Verifying GitHub identity';
  const check = () => { if (guard !== epoch || document.hidden) throw new Error('Sign in again to continue.'); };
  try {
    let session = await api(service, '/auth/exchange', '', { ticket }); check();
    let next = await api(service, '/passkey/options', session.token, {}); check();
    if (next.mode === 'register') {
      $('login-state').textContent = 'Create a Passkey for Income';
      const credential = await navigator.credentials.create({ publicKey: creationOptions(next.options, next.salt) }); check();
      if (!credential?.getClientExtensionResults().prf?.enabled) throw new Error('This browser cannot create an encryption-ready Passkey. Use a compatible browser.');
      session = await api(service, '/passkey/verify', session.token, { credential: passkeyJSON(credential), mode: 'register' }); check();
      next = await api(service, '/passkey/options', session.token, {}); check();
    }
    $('login-state').textContent = 'Verify your Passkey';
    const credential = await navigator.credentials.get({ publicKey: requestOptions(next.options, next.salt) }); check();
    const secret = credential?.getClientExtensionResults().prf?.results?.first;
    if (!secret || secret.byteLength !== 32) throw new Error('Passkey encryption is unavailable. No financial data has been opened.');
    const encryptionKey = await deriveKey(secret, next.salt); new Uint8Array(secret).fill(0); check();
    const verified = await api(service, '/passkey/verify', session.token, { credential: passkeyJSON(credential), mode: 'login' }); check();
    token = verified.token; key = encryptionKey;
    const stored = await api(service, '/vault', token); check();
    state = stored.box ? await open(stored.box, key) : emptyState(); check();
    revision = stored.revision; baseline = structuredClone(state); dirty = false; lastActivity = Date.now(); lastTouch = Date.now(); hiddenAt = 0; render();
  } catch (error) { if (guard === epoch) lock(error.name === 'NotAllowedError' ? 'Passkey verification was cancelled.' : error.message || 'Sign-in failed.'); }
}
async function activity() {
  if (!state || document.hidden) return;
  const now = Date.now();
  if (now - lastActivity >= 600_000) { lock('Your session has expired. Sign in again.'); return; }
  lastActivity = now;
  if (now - lastTouch < 30_000) return;
  lastTouch = now; const guard = epoch;
  try { await api(service, '/session/touch', token, { active: true }); }
  catch (error) { if (guard === epoch) failure(error); }
}
$('dialog-close').onclick = closeDialog; $('lock').onclick = () => lock();
$('dialog').addEventListener('cancel', event => { if (publishing) event.preventDefault(); });
document.querySelector('.brand').addEventListener('click', event => { if (state) { event.preventDefault(); goHome(); } });
for (const event of ['pointerdown', 'keydown']) document.addEventListener(event, event => { if (event.isTrusted) activity(); }, { passive: true });
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); $('root').replaceChildren(); $('dialog').close(); $('dialog-content').replaceChildren(); $('dialog-actions').replaceChildren(); $('header-actions').hidden = true; $('toast').hidden = true; }
  else if (state) {
    if (Date.now() - hiddenAt >= 600_000 || Date.now() - lastActivity >= 600_000) lock('Your session has expired. Sign in again.');
    else render();
  } else loginScreen('Sign in to continue.');
});
setInterval(() => { if (state && Date.now() - lastActivity >= 600_000) lock('Your session has expired. Sign in again.'); }, 1000);
async function init() {
  const ticket = new URLSearchParams(location.hash.slice(1)).get('ticket');
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  try {
    const response = await fetch('./config.json', { cache: 'no-store' });
    const config = await response.json();
    if (!config.service) { loginScreen('Secure service is not configured. Financial data remains locked.'); return; }
    const url = new URL(config.service);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid secure service configuration.');
    service = url.origin;
    const health = await api(service, '/health');
    if (!health.ready) { service = ''; throw new Error('Secure service is not ready.'); }
    loginScreen('Verify with your Mac or iPhone Passkey.');
    if (ticket) await unlock(ticket);
  } catch (error) { service = ''; loginScreen(error.message || 'Secure service is unavailable.'); }
}
init();
