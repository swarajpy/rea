/* rea app: voice or text -> bill -> customer ledger. All data stays on this device. */
(function () {
  'use strict';

  const Parser = window.ReaParser;
  const Store = window.ReaStore;

  /* ---------- storage (never let a blocked localStorage break the app) ---------- */
  function openStorage() {
    try {
      const probe = '__rea_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return { api: window.localStorage, persistent: true };
    } catch (e) {
      const mem = {};
      return {
        api: { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } },
        persistent: false,
      };
    }
  }
  const storage = openStorage();
  const store = Store.createStore(storage.api);

  /* ---------- tiny helpers ---------- */
  const $ = (id) => document.getElementById(id);

  /* ---------- Android app shell (Capacitor) ----------
     In the installed Android app the page runs in a WebView. A WebView has no browser
     speech recognition, no file downloads, no print dialog and no window.open, so those
     four things go through native plugins there. In a normal browser none of this runs. */
  const cap = window.Capacitor;
  const isNative = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
  const nativePlugins = {};
  const nativePlugin = (name) => {
    if (!isNative) return null;
    if (!nativePlugins[name]) nativePlugins[name] = cap.registerPlugin(name);
    return nativePlugins[name];
  };
  function openExternal(url) {
    if (isNative) {
      nativePlugin('Browser').open({ url }).catch(() => toast('Could not open the link.'));
    } else {
      window.open(url, '_blank', 'noopener');
    }
  }

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid);
    }
    return el;
  }

  const nf = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
  const money = (n) => '₹' + nf.format(Number(n) || 0);
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const when = (ts) => new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

  let toastTimer = null;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
  }

  function qtyLabel(it) {
    return `${nf.format(it.qty)}${it.unit ? ' ' + it.unit : ''} × ${money(it.rate)}`;
  }

  /* ---------- tabs ---------- */
  let ledgerKey = null; // customer currently open in the ledger

  function switchView(name) {
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
    if (name === 'ledger') renderLedger();
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    if (t.dataset.view === 'ledger') ledgerKey = null;
    switchView(t.dataset.view);
  }));

  /* ---------- record: examples, voice, parse ---------- */
  const EXAMPLES = [
    'Sharma ji took 20 kg onion at 30, paid 400',
    'Patil kaka ni 10 kilo kanda 25 rate ne ghetla, 100 dile',
    'शर्मा जी ने २० किलो प्याज ३० रुपये किलो लिया ४०० दिए',
    'Sunita took 3 dozen eggs at 70 udhar',
    'Sharma ji paid 400',
  ];
  $('examples').append(
    ...EXAMPLES.map((text) =>
      h('button', { class: 'chip', type: 'button', onclick: () => { $('speech').value = text; parseNow(); } }, text.length > 34 ? text.slice(0, 32) + '…' : text)
    )
  );

  let draft = null;

  function parseNow() {
    const text = $('speech').value.trim();
    if (!text) { toast('Say or type a sale first.'); return; }
    const r = Parser.parse(text);
    if (r.kind === 'payment') {
      draft = { kind: 'payment', customer: r.customer, amount: r.paid, warnings: r.warnings };
    } else {
      const items = r.items.map((i) => ({ name: i.name, qty: i.qty, unit: i.unit, rate: i.rate == null ? '' : i.rate }));
      if (!items.length) items.push({ name: '', qty: 1, unit: '', rate: '' });
      draft = { kind: 'sale', customer: r.customer, items, paid: r.paid, warnings: r.warnings };
    }
    renderReview();
    $('review').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  $('parseBtn').addEventListener('click', parseNow);

  function customerField(label, value, onInput) {
    const list = h('datalist', { id: 'custNames' }, store.customers().filter((c) => c.name !== Store.WALK_IN).map((c) => h('option', { value: c.name })));
    const input = h('input', { type: 'text', value, list: 'custNames', placeholder: 'Customer name (blank = Walk-in)', autocomplete: 'off', oninput: (e) => onInput(e.target.value) });
    return h('label', { class: 'field' }, h('span', {}, label), input, list);
  }

  function renderReview() {
    const box = $('review');
    box.replaceChildren();
    if (!draft) { box.hidden = true; return; }
    box.hidden = false;
    box.append(draft.kind === 'payment' ? paymentCard() : saleCard());
  }

  function warningsList() {
    return draft.warnings.length ? h('ul', { class: 'warnings' }, draft.warnings.map((w) => h('li', {}, w))) : null;
  }

  function paymentCard() {
    const amount = h('input', { type: 'number', inputmode: 'decimal', min: '0', step: 'any', value: draft.amount, oninput: (e) => { draft.amount = e.target.value; } });
    return h('div', { class: 'card' },
      h('h2', {}, 'Payment received'),
      warningsList(),
      customerField('From', draft.customer, (v) => { draft.customer = v; }),
      h('label', { class: 'field' }, h('span', {}, 'Amount (₹)'), amount),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', type: 'button', onclick: savePayment }, 'Save payment'),
        h('button', { class: 'btn', type: 'button', onclick: discardDraft }, 'Discard')
      )
    );
  }

  function savePayment() {
    if (!String(draft.customer).trim()) { toast('Who paid? Type the customer name.'); return; }
    try {
      store.addPayment(draft.customer, draft.amount, 'Payment received');
      toast(`Saved ${money(draft.amount)} from ${draft.customer.trim()}.`);
      discardDraft(true);
    } catch (e) { toast(e.message); }
  }

  function saleCard() {
    const amtEls = [];
    const totalEl = h('span', {}, money(0));
    const dueEl = h('span', { class: 'due' }, money(0));
    const paidInput = h('input', { type: 'number', inputmode: 'decimal', min: '0', step: 'any', value: draft.paid, 'aria-label': 'Paid amount', oninput: (e) => { draft.paid = e.target.value; update(); } });

    const lineTotal = (it) => round2((it.qty === '' ? 1 : Number(it.qty)) * (Number(it.rate) || 0));
    const total = () => round2(draft.items.reduce((s, it) => s + lineTotal(it), 0));

    function update() {
      draft.items.forEach((it, i) => { amtEls[i].textContent = it.name || lineTotal(it) ? `${money(lineTotal(it))}` : ''; });
      const t = total();
      totalEl.textContent = money(t);
      dueEl.textContent = money(Math.max(0, round2(t - (Number(draft.paid) || 0))));
    }

    function row(it, i) {
      const amt = h('div', { class: 'amt' });
      amtEls[i] = amt;
      const num = (key, label, extra) => h('input', Object.assign({ type: 'number', inputmode: 'decimal', min: '0', step: 'any', value: it[key], 'aria-label': label, oninput: (e) => { it[key] = e.target.value; update(); } }, extra));
      return h('div', { class: 'item' },
        h('input', { type: 'text', value: it.name, placeholder: 'Item', 'aria-label': 'Item name', autocomplete: 'off', oninput: (e) => { it.name = e.target.value; update(); } }),
        num('qty', 'Quantity'),
        h('input', { type: 'text', value: it.unit, placeholder: 'kg', 'aria-label': 'Unit', autocomplete: 'off', oninput: (e) => { it.unit = e.target.value; } }),
        num('rate', 'Price per unit'),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Remove item', onclick: () => { draft.items.splice(i, 1); if (!draft.items.length) draft.items.push({ name: '', qty: 1, unit: '', rate: '' }); renderReview(); } }, '×'),
        amt
      );
    }

    const card = h('div', { class: 'card' },
      h('h2', {}, 'Check the bill'),
      warningsList(),
      customerField('Customer', draft.customer, (v) => { draft.customer = v; }),
      h('div', { class: 'items' },
        h('div', { class: 'item item-head' }, h('span', {}, 'Item'), h('span', {}, 'Qty'), h('span', {}, 'Unit'), h('span', {}, 'Price'), h('span')),
        draft.items.map(row)
      ),
      h('button', { class: 'btn small', type: 'button', onclick: () => { draft.items.push({ name: '', qty: 1, unit: '', rate: '' }); renderReview(); } }, '+ Add item'),
      h('div', { class: 'totals' },
        h('div', { class: 'line big' }, h('span', {}, 'Total'), totalEl),
        h('div', { class: 'line' }, h('span', {}, 'Paid now'), paidInput),
        h('div', { class: 'row' },
          h('button', { class: 'btn small', type: 'button', onclick: () => { draft.paid = total(); paidInput.value = draft.paid; update(); } }, 'Paid in full'),
          h('button', { class: 'btn small', type: 'button', onclick: () => { draft.paid = 0; paidInput.value = 0; update(); } }, 'Udhar (nothing paid)')
        ),
        h('div', { class: 'line' }, h('span', {}, 'Balance due'), dueEl)
      ),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', type: 'button', onclick: saveSale }, 'Save & show bill'),
        h('button', { class: 'btn', type: 'button', onclick: () => discardDraft() }, 'Discard')
      )
    );
    update();
    return card;
  }

  function saveSale() {
    try {
      const entry = store.addSale({ customer: draft.customer, items: draft.items, paid: draft.paid });
      discardDraft(true);
      showBill(entry);
    } catch (e) { toast(e.message); }
  }

  function discardDraft(clearText) {
    draft = null;
    if (clearText === true) $('speech').value = '';
    renderReview();
  }

  /* ---------- bill ---------- */
  function billText(entry) {
    const shop = store.settings().shop || 'Bill';
    const lines = [`*${shop}*`, `Bill ${entry.invoice} · ${when(entry.ts)}`, entry.customer, ''];
    entry.items.forEach((it) => lines.push(`• ${it.name} ${qtyLabel(it)} = ${money(it.amount)}`));
    lines.push('', `Total: ${money(entry.total)}`, `Paid: ${money(entry.paid)}`);
    const due = round2(entry.total - entry.paid);
    lines.push(due > 0 ? `*Balance due: ${money(due)}*` : 'Paid in full. Thank you!');
    return lines.join('\n');
  }

  function showBill(entry) {
    const dlg = $('billDialog');
    const s = store.settings();
    const due = round2(entry.total - entry.paid);
    const account = store.balanceOf(entry.key);
    const isWalkIn = entry.key === Store.keyOf(Store.WALK_IN);

    const table = h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Item'), h('th', {}, 'Amount'))),
      h('tbody', {}, entry.items.map((it) => h('tr', {}, h('td', {}, it.name, h('small', {}, qtyLabel(it))), h('td', {}, money(it.amount)))))
    );
    const sums = h('div', { class: 'sums' },
      h('div', { class: 'line big' }, h('span', {}, 'Total'), h('span', {}, money(entry.total))),
      h('div', { class: 'line' }, h('span', {}, 'Paid'), h('span', {}, money(entry.paid))),
      due > 0 ? h('div', { class: 'line' }, h('span', {}, 'Balance due on this bill'), h('span', { class: 'due' }, money(due))) : h('div', { class: 'line' }, h('span', {}, 'Paid in full'), h('span')),
      !isWalkIn && account !== due ? h('div', { class: 'line' }, h('span', {}, account < 0 ? 'Advance on account' : 'Total on account now'), h('span', { class: account > 0 ? 'due' : '' }, money(Math.abs(account)))) : null
    );

    dlg.replaceChildren(
      h('div', { class: 'paper' },
        h('h3', {}, s.shop || 'Bill'),
        h('div', { class: 'sub' }, `${entry.invoice} · ${when(entry.ts)}`),
        h('div', {}, h('strong', {}, entry.customer)),
        table,
        sums,
        h('div', { class: 'thanks' }, 'Thank you!')
      ),
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => openExternal('https://wa.me/?text=' + encodeURIComponent(billText(entry))) }, 'WhatsApp'),
        isNative ? null : h('button', { class: 'btn', type: 'button', onclick: () => window.print() }, 'Print / PDF'),
        h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Close')
      )
    );
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
  }

  /* ---------- ledger ---------- */
  function renderLedger() {
    const list = $('ledgerList');
    const detail = $('ledgerDetail');
    if (ledgerKey) { list.hidden = true; detail.hidden = false; renderDetail(); return; }
    detail.hidden = true;
    list.hidden = false;

    const customers = store.customers();
    if (!customers.length) {
      list.replaceChildren(h('div', { class: 'empty' }, 'No sales yet.', h('br'), 'Record your first one on the Record tab.'));
      return;
    }
    const owing = customers.filter((c) => c.balance > 0);
    const search = h('input', { type: 'search', placeholder: 'Search customer', 'aria-label': 'Search customer', autocomplete: 'off', oninput: (e) => paint(e.target.value) });
    const holder = h('div', { class: 'cust-list' });

    function paint(q) {
      const needle = String(q || '').trim().toLowerCase();
      const shown = customers.filter((c) => c.name.toLowerCase().includes(needle));
      holder.replaceChildren(
        ...(shown.length
          ? shown.map((c) => h('button', { class: 'cust', type: 'button', onclick: () => { ledgerKey = c.key; renderLedger(); window.scrollTo(0, 0); } },
              h('span', {}, c.name, h('small', {}, `${c.count} ${c.count === 1 ? 'entry' : 'entries'} · last ${when(c.last)}`)),
              h('span', { class: 'owes' + (c.balance === 0 ? ' zero' : c.balance < 0 ? ' adv' : '') }, c.balance === 0 ? 'Settled' : c.balance < 0 ? 'Advance ' + money(-c.balance) : money(c.balance))))
          : [h('div', { class: 'empty' }, 'No match.')])
      );
    }
    paint('');
    list.replaceChildren(
      h('div', { class: 'summary' }, h('span', {}, 'To collect'), h('strong', {}, money(store.totalOutstanding())), h('span', {}, `from ${owing.length} ${owing.length === 1 ? 'customer' : 'customers'}`)),
      search,
      holder
    );
  }

  function renderDetail() {
    const detail = $('ledgerDetail');
    const entries = store.entriesFor(ledgerKey);
    if (!entries.length) { ledgerKey = null; renderLedger(); return; }
    const name = entries[0].customer;
    const bal = store.balanceOf(ledgerKey);
    const amount = h('input', { type: 'number', inputmode: 'decimal', min: '0', step: 'any', placeholder: 'Amount received (₹)', 'aria-label': 'Amount received' });

    const remind = () => {
      const shop = store.settings().shop || 'our shop';
      const text = `Namaste ${name}, a gentle reminder from ${shop}: your balance is ${money(bal)}. Please pay when you can. Thank you!`;
      openExternal('https://wa.me/?text=' + encodeURIComponent(text));
    };

    detail.replaceChildren(
      h('div', { class: 'detail-head' },
        h('button', { class: 'btn small', type: 'button', onclick: () => { ledgerKey = null; renderLedger(); } }, '← All'),
        h('h2', {}, name)
      ),
      h('div', { class: 'bigbal' + (bal > 0 ? ' owes' : '') }, bal > 0 ? money(bal) : bal < 0 ? 'Advance ' + money(-bal) : 'Settled'),
      h('div', { class: 'hint' }, bal > 0 ? 'owed to you' : bal < 0 ? 'paid ahead' : 'nothing due'),
      h('div', { class: 'pay' },
        amount,
        h('button', { class: 'btn primary', type: 'button', onclick: () => {
          try { store.addPayment(name, amount.value, 'Payment received'); toast(`Saved ${money(amount.value)} from ${name}.`); renderLedger(); } catch (e) { toast('Enter the amount received.'); }
        } }, 'Receive')
      ),
      bal > 0 ? h('button', { class: 'btn small', type: 'button', onclick: remind }, 'Send WhatsApp reminder') : null,
      h('div', { class: 'entries' }, entries.map(entryCard))
    );
  }

  function entryCard(e) {
    const remove = () => {
      if (window.confirm('Delete this entry? The customer balance will change.')) { store.remove(e.id); toast('Entry deleted.'); renderLedger(); }
    };
    if (e.type === 'payment') {
      return h('div', { class: 'entry' },
        h('div', { class: 'meta' }, h('span', {}, 'Payment received'), h('span', {}, when(e.ts))),
        h('div', { class: 'what' }, h('span', {}, e.note || 'Payment'), h('strong', {}, '− ' + money(e.amount))),
        h('div', { class: 'btns' }, h('button', { class: 'btn small danger', type: 'button', onclick: remove }, 'Delete'))
      );
    }
    const due = round2(e.total - e.paid);
    return h('div', { class: 'entry' },
      h('div', { class: 'meta' }, h('span', {}, e.invoice), h('span', {}, when(e.ts))),
      h('div', { class: 'what' }, h('span', {}, e.items.map((i) => i.name).join(', ')), h('strong', {}, money(e.total))),
      h('div', { class: 'meta' }, h('span', {}, `Paid ${money(e.paid)}`), h('span', {}, due > 0 ? `Due ${money(due)}` : 'Paid in full')),
      h('div', { class: 'btns' },
        h('button', { class: 'btn small', type: 'button', onclick: () => showBill(e) }, 'View bill'),
        h('button', { class: 'btn small danger', type: 'button', onclick: remove }, 'Delete')
      )
    );
  }

  /* ---------- settings ---------- */
  const settings = store.settings();
  $('shopName').value = settings.shop;
  $('lang').value = settings.lang;
  const paintShop = () => { $('shopLabel').textContent = store.settings().shop; };
  paintShop();
  $('shopName').addEventListener('input', (e) => { store.setSettings({ shop: e.target.value }); paintShop(); });
  $('lang').addEventListener('change', (e) => store.setSettings({ lang: e.target.value }));

  $('exportBtn').addEventListener('click', async () => {
    const fileName = `rea-backup-${new Date().toISOString().slice(0, 10)}.json`;
    if (isNative) {
      // A WebView cannot download a blob, so write the file and open the Android share sheet.
      try {
        const saved = await nativePlugin('Filesystem').writeFile({ path: fileName, data: store.exportJSON(), directory: 'CACHE', encoding: 'utf8' });
        await nativePlugin('Share').share({ title: 'rea backup', files: [saved.uri] });
      } catch (err) {
        if (!/cancel/i.test(String((err && err.message) || err))) toast('Could not share the backup.');
      }
      return;
    }
    const blob = new Blob([store.exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: fileName });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
  $('importFile').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const r = store.importJSON(await file.text());
      toast(r.added ? `Restored ${r.added} entries.` : 'Nothing new in that backup.');
    } catch (err) { toast(err.message || 'Could not read that file.'); }
  });

  if (!storage.persistent) $('storageNotice').hidden = false;

  /* ---------- voice ---------- */
  function setupNativeVoice() {
    // Android app: use the phone's own speech recogniser through a Capacitor plugin.
    const Speech = nativePlugin('SpeechRecognition');
    const mic = $('mic');
    let listening = false;
    let safety = null;

    const setUi = (on) => {
      listening = on;
      mic.classList.toggle('listening', on);
      mic.setAttribute('aria-label', on ? 'Stop listening' : 'Start speaking');
      $('micState').textContent = on ? 'Listening… tap to stop' : 'Tap and say the sale';
      clearTimeout(safety);
      if (on) safety = setTimeout(() => { Speech.stop().catch(() => {}); }, 25000);
    };
    const finish = () => {
      if (!listening) return;
      setUi(false);
      if ($('speech').value.trim()) parseNow();
    };

    Speech.addListener('partialResults', (data) => {
      if (data && data.matches && data.matches.length) $('speech').value = String(data.matches[0]).trim();
    });
    Speech.addListener('listeningState', (data) => {
      if (data && data.status === 'stopped') finish();
    });

    mic.addEventListener('click', async () => {
      if (listening) {
        try { await Speech.stop(); } catch (err) { /* already stopped */ }
        finish();
        return;
      }
      try {
        const avail = await Speech.available();
        if (!avail.available) { toast('This phone has no speech recognition. You can type the sale.'); return; }
        let perm = await Speech.checkPermissions();
        if (perm.speechRecognition !== 'granted') perm = await Speech.requestPermissions();
        if (perm.speechRecognition !== 'granted') { toast('Microphone is blocked. Allow it in Android settings.'); return; }
        setUi(true);
        await Speech.start({ language: $('lang').value, maxResults: 1, partialResults: true, popup: false });
      } catch (err) {
        setUi(false);
        toast('Could not start the microphone. You can type the sale.');
      }
    });
  }

  (function setupVoice() {
    if (isNative) { setupNativeVoice(); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const mic = $('mic');
    if (!SR) {
      mic.disabled = true;
      $('micState').textContent = 'Voice not available here';
      $('micHint').textContent = 'This browser has no speech recognition. Type the sale below, or open rea in Chrome on Android.';
      return;
    }
    let rec = null;
    let listening = false;

    const setUi = (on) => {
      listening = on;
      mic.classList.toggle('listening', on);
      mic.setAttribute('aria-label', on ? 'Stop listening' : 'Start speaking');
      $('micState').textContent = on ? 'Listening… tap to stop' : 'Tap and say the sale';
    };

    mic.addEventListener('click', () => {
      if (listening) { rec.stop(); return; }
      rec = new SR();
      rec.lang = $('lang').value;
      rec.interimResults = true;
      rec.continuous = false;
      rec.onresult = (ev) => {
        let text = '';
        for (let i = 0; i < ev.results.length; i++) text += ev.results[i][0].transcript + ' ';
        $('speech').value = text.trim();
      };
      rec.onerror = (ev) => {
        const msg = {
          'not-allowed': 'Microphone is blocked. Allow it in the browser settings.',
          'service-not-allowed': 'Microphone is blocked. Allow it in the browser settings.',
          'no-speech': "Didn't catch that. Try again.",
          network: 'Voice needs internet in this browser. You can still type.',
          'language-not-supported': 'That language is not supported for voice here.',
        }[ev.error] || 'Voice input stopped. You can type instead.';
        toast(msg);
      };
      rec.onend = () => {
        setUi(false);
        if ($('speech').value.trim()) parseNow();
      };
      try { rec.start(); setUi(true); } catch (err) { setUi(false); toast('Could not start the microphone.'); }
    });
  })();

  /* ---------- offline support ---------- */
  if (!isNative && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
