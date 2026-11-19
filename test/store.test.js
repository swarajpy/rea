'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../store.js');

function memory() {
  const data = {};
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
}

const onion = [{ name: 'Onion', qty: 20, unit: 'kg', rate: 30 }];

test('a sale creates an invoice number and a balance', () => {
  const s = createStore(memory());
  const sale = s.addSale({ customer: 'Sharma ji', items: onion, paid: 400 });
  assert.equal(sale.invoice, 'INV-0001');
  assert.equal(sale.total, 600);
  assert.equal(s.balanceOf('sharma ji'), 200);
  assert.equal(s.addSale({ customer: 'Sharma Ji', items: onion, paid: 0 }).invoice, 'INV-0002');
  assert.equal(s.balanceOf('sharma ji'), 800); // same customer, different capitalisation
});

test('payments reduce the balance', () => {
  const s = createStore(memory());
  s.addSale({ customer: 'Sharma ji', items: onion, paid: 0 });
  s.addPayment('sharma ji', 250);
  assert.equal(s.balanceOf('sharma ji'), 350);
  assert.equal(s.totalOutstanding(), 350);
});

test('paying more than the bill is kept as an advance, not lost', () => {
  const s = createStore(memory());
  const sale = s.addSale({ customer: 'Asha', items: onion, paid: 700 });
  assert.equal(sale.paid, 600);
  assert.equal(s.balanceOf('asha'), -100);
});

test('rejects empty sales and zero payments', () => {
  const s = createStore(memory());
  assert.throws(() => s.addSale({ customer: 'X', items: [], paid: 0 }));
  assert.throws(() => s.addSale({ customer: 'X', items: [{ name: 'Tea', qty: 1, rate: 0 }], paid: 0 }));
  assert.throws(() => s.addPayment('X', 0));
});

test('no customer becomes Walk-in', () => {
  const s = createStore(memory());
  assert.equal(s.addSale({ customer: '', items: onion, paid: 600 }).customer, 'Walk-in');
});

test('data survives a reload', () => {
  const storage = memory();
  const a = createStore(storage);
  a.addSale({ customer: 'Sharma ji', items: onion, paid: 100 });
  a.setSettings({ shop: 'Patil Kirana' });
  const b = createStore(storage);
  assert.equal(b.balanceOf('sharma ji'), 500);
  assert.equal(b.settings().shop, 'Patil Kirana');
  assert.equal(b.addSale({ customer: 'Z', items: onion, paid: 0 }).invoice, 'INV-0002');
});

test('customers are listed with who owes most first', () => {
  const s = createStore(memory());
  s.addSale({ customer: 'Small', items: [{ name: 'Tea', qty: 1, rate: 50 }], paid: 0 });
  s.addSale({ customer: 'Big', items: onion, paid: 0 });
  s.addSale({ customer: 'Settled', items: onion, paid: 600 });
  assert.deepEqual(s.customers().map((c) => c.name), ['Big', 'Small', 'Settled']);
});

test('delete removes an entry and fixes the balance', () => {
  const s = createStore(memory());
  const sale = s.addSale({ customer: 'A', items: onion, paid: 0 });
  assert.equal(s.remove(sale.id), true);
  assert.equal(s.balanceOf('a'), 0);
});

test('backup export and import merge without duplicates', () => {
  const a = createStore(memory());
  a.addSale({ customer: 'A', items: onion, paid: 0 });
  const backup = a.exportJSON();
  const b = createStore(memory());
  assert.equal(b.importJSON(backup).added, 1);
  assert.equal(b.importJSON(backup).added, 0);
  assert.equal(b.balanceOf('a'), 600);
  assert.throws(() => b.importJSON('{"nope":1}'));
});

test('a broken or unavailable storage does not crash the app', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); } };
  const s = createStore(broken);
  const sale = s.addSale({ customer: 'A', items: onion, paid: 0 });
  assert.equal(sale.total, 600);
  assert.equal(s.balanceOf('a'), 600);
});
