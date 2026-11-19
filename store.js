/*
 * rea store: a tiny customer ledger kept on the device.
 *
 * Everything lives in one JSON document (localStorage in the browser). A customer's
 * balance is derived from their entries, never stored, so it cannot drift:
 *   balance = sum(sale.total - sale.paid) - sum(payments)
 * Positive balance = the customer owes you. Negative = they are in advance.
 *
 * Works in the browser (window.ReaStore) and in Node (require). Pass any
 * { getItem, setItem } object as storage, which is how the tests run it.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReaStore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KEY = 'rea.v1';
  const WALK_IN = 'Walk-in';
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const keyOf = (name) => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');

  function createStore(storage, now) {
    const clock = now || (() => Date.now());
    let state = load();

    function blank() {
      return { v: 1, seq: 0, settings: { shop: 'My Shop', lang: 'en-IN' }, entries: [] };
    }

    function load() {
      try {
        const raw = storage.getItem(KEY);
        if (raw) {
          const saved = JSON.parse(raw);
          if (saved && Array.isArray(saved.entries)) {
            const base = blank();
            return Object.assign(base, saved, { settings: Object.assign(base.settings, saved.settings || {}) });
          }
        }
      } catch (e) {
        /* fall through to a blank ledger */
      }
      return blank();
    }

    function persist() {
      try {
        storage.setItem(KEY, JSON.stringify(state));
        return true;
      } catch (e) {
        return false;
      }
    }

    const uid = () => clock().toString(36) + Math.random().toString(36).slice(2, 7);

    function cleanItems(items) {
      return (items || [])
        .map((it) => {
          const qty = it.qty == null || it.qty === '' ? 1 : Number(it.qty);
          const rate = Number(it.rate) || 0;
          return {
            name: String(it.name || '').trim(),
            qty: Number.isFinite(qty) ? qty : 0,
            unit: String(it.unit || '').trim(),
            rate,
            amount: round2(qty * rate),
          };
        })
        .filter((it) => it.name && it.amount > 0);
    }

    function addPayment(customer, amount, note) {
      const value = round2(amount);
      if (!(value > 0)) throw new Error('Payment must be more than zero.');
      const name = String(customer || '').trim() || WALK_IN;
      const entry = { id: uid(), type: 'payment', ts: clock(), customer: name, key: keyOf(name), amount: value, note: note || '' };
      state.entries.push(entry);
      persist();
      return entry;
    }

    function addSale(input) {
      const items = cleanItems(input.items);
      if (!items.length) throw new Error('Add at least one item with a price.');
      const total = round2(items.reduce((s, it) => s + it.amount, 0));
      const paidRaw = Math.max(0, round2(input.paid));
      const paid = Math.min(paidRaw, total);
      const name = String(input.customer || '').trim() || WALK_IN;

      state.seq += 1;
      const entry = {
        id: uid(),
        type: 'sale',
        ts: clock(),
        invoice: 'INV-' + String(state.seq).padStart(4, '0'),
        customer: name,
        key: keyOf(name),
        items,
        total,
        paid,
      };
      state.entries.push(entry);
      // Anything paid beyond the total is not lost: it becomes an advance.
      if (paidRaw > total) {
        state.entries.push({
          id: uid(),
          type: 'payment',
          ts: clock(),
          customer: name,
          key: entry.key,
          amount: round2(paidRaw - total),
          note: 'Advance (paid more than bill ' + entry.invoice + ')',
        });
      }
      persist();
      return entry;
    }

    function balanceOf(key) {
      let bal = 0;
      for (const e of state.entries) {
        if (e.key !== key) continue;
        bal += e.type === 'sale' ? e.total - e.paid : -e.amount;
      }
      return round2(bal);
    }

    function customers() {
      const map = new Map();
      for (const e of [...state.entries].sort((a, b) => a.ts - b.ts)) {
        const c = map.get(e.key) || { key: e.key, name: e.customer, balance: 0, last: 0, count: 0 };
        c.name = e.customer; // latest spelling wins
        c.last = Math.max(c.last, e.ts);
        c.count += 1;
        c.balance += e.type === 'sale' ? e.total - e.paid : -e.amount;
        map.set(e.key, c);
      }
      const list = [...map.values()].map((c) => ({ ...c, balance: round2(c.balance) }));
      return list.sort((a, b) => (b.balance > 0) - (a.balance > 0) || b.balance - a.balance || b.last - a.last);
    }

    return {
      WALK_IN,
      keyOf,
      addSale,
      addPayment,
      balanceOf,
      customers,
      entriesFor: (key) => state.entries.filter((e) => e.key === key).sort((a, b) => b.ts - a.ts),
      getEntry: (id) => state.entries.find((e) => e.id === id) || null,
      remove(id) {
        const before = state.entries.length;
        state.entries = state.entries.filter((e) => e.id !== id);
        persist();
        return state.entries.length < before;
      },
      totalOutstanding() {
        return round2(customers().reduce((s, c) => s + Math.max(0, c.balance), 0));
      },
      settings: () => ({ ...state.settings }),
      setSettings(patch) {
        Object.assign(state.settings, patch);
        persist();
      },
      exportJSON: () => JSON.stringify(state, null, 2),
      importJSON(text) {
        const data = JSON.parse(text);
        if (!data || !Array.isArray(data.entries)) throw new Error('This is not a rea backup file.');
        const have = new Set(state.entries.map((e) => e.id));
        let added = 0;
        for (const e of data.entries) {
          if (e && e.id && e.key != null && (e.type === 'sale' || e.type === 'payment') && !have.has(e.id)) {
            state.entries.push(e);
            added++;
          }
        }
        state.seq = Math.max(state.seq, Number(data.seq) || 0);
        persist();
        return { added, total: data.entries.length };
      },
      isPersisted: persist,
    };
  }

  return { createStore, keyOf, WALK_IN };
});
