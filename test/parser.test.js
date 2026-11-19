'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('../parser.js');

const item = (name, qty, unit, rate, amount) => ({ name, qty, unit, rate, amount });

test('English: the headline example', () => {
  const r = parse('Sharma ji took 20 kg onion at 30, paid 400');
  assert.equal(r.kind, 'sale');
  assert.equal(r.customer, 'Sharma ji');
  assert.deepEqual(r.items, [item('Onion', 20, 'kg', 30, 600)]);
  assert.equal(r.total, 600);
  assert.equal(r.paid, 400);
  assert.equal(r.due, 200);
  assert.equal(r.confidence, 'high');
});

test('several items joined by "and"', () => {
  const r = parse('Rajesh bought 2 kg sugar at 45 and 1 kg tea at 400, paid 300');
  assert.equal(r.items.length, 2);
  assert.equal(r.total, 490);
  assert.equal(r.paid, 300);
  assert.equal(r.due, 190);
});

test('Hindi in Latin script (SOV order, amount before the verb)', () => {
  const r = parse('Sharma ji ne 20 kilo pyaz 30 rupaye kilo liya, 400 diye');
  assert.equal(r.customer, 'Sharma ji');
  assert.deepEqual(r.items, [item('Pyaz', 20, 'kg', 30, 600)]);
  assert.equal(r.paid, 400);
  assert.equal(r.due, 200);
});

test('Marathi in Latin script', () => {
  const r = parse('Patil kaka ni 10 kilo kanda 25 rate ne ghetla, 100 dile');
  assert.equal(r.customer, 'Patil Kaka');
  assert.deepEqual(r.items, [item('Kanda', 10, 'kg', 25, 250)]);
  assert.equal(r.paid, 100);
  assert.equal(r.due, 150);
});

test('Devanagari script and Devanagari digits', () => {
  const r = parse('शर्मा जी ने २० किलो प्याज ३० रुपये किलो लिया ४०० दिए');
  assert.equal(r.customer, 'शर्मा जी');
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].qty, 20);
  assert.equal(r.items[0].rate, 30);
  assert.equal(r.total, 600);
  assert.equal(r.paid, 400);
});

test('number words, and "paid in full"', () => {
  const r = parse('Amit took twenty five kg rice at sixty, paid in full');
  assert.equal(r.items[0].qty, 25);
  assert.equal(r.items[0].rate, 60);
  assert.equal(r.total, 1500);
  assert.equal(r.paid, 1500);
  assert.equal(r.due, 0);
});

test('"udhar" means on credit', () => {
  const r = parse('Sunita took 3 dozen eggs at 70 udhar');
  assert.deepEqual(r.items, [item('Eggs', 3, 'dozen', 70, 210)]);
  assert.equal(r.paid, 0);
  assert.equal(r.due, 210);
});

test('fractions: half, dedh', () => {
  const r = parse('Ravi took half kg sugar at 44 and dedh kilo dal at 120, paid 200');
  assert.equal(r.items[0].qty, 0.5);
  assert.equal(r.items[1].qty, 1.5);
  assert.equal(r.total, 202);
  assert.equal(r.due, 2);
});

test('line total with "for"', () => {
  const r = parse('Meena took 3 soap for 60');
  assert.deepEqual(r.items, [item('Soap', 3, '', 20, 60)]);
  assert.equal(r.total, 60);
});

test('grams are converted to kg', () => {
  const r = parse('Raj took 500 g sugar at 45 per kg');
  assert.deepEqual(r.items, [item('Sugar', 0.5, 'kg', 45, 22.5)]);
});

test('compound number words with "and"', () => {
  const r = parse('Kiran took tea total two hundred and fifty, paid fifty');
  assert.equal(r.total, 250);
  assert.equal(r.paid, 50);
  assert.equal(r.due, 200);
});

test('a surname that is also a number word stays a name', () => {
  const r = parse('Das ji took 5 kg rice at 60');
  assert.equal(r.customer, 'Das ji');
  assert.equal(r.total, 300);
});

test('rupee symbol and "rs"', () => {
  assert.equal(parse('Sharma ji took 20 kg onion at ₹30, paid ₹400').due, 200);
  assert.equal(parse('Sharma ji took 20 kg onion at rs 30 paid rs.400').due, 200);
  assert.equal(parse('Sharma ji took 20kg onion at 30 paid 400').due, 200);
});

test('explicit balance', () => {
  const r = parse('Raju took 10 kg rice at 50, baki 300');
  assert.equal(r.total, 500);
  assert.equal(r.due, 300);
  assert.equal(r.paid, 200);
});

test('a bare payment is not a sale', () => {
  const a = parse('Sharma ji paid 400');
  assert.equal(a.kind, 'payment');
  assert.equal(a.customer, 'Sharma ji');
  assert.equal(a.paid, 400);
  const b = parse('Sharma ji ne 400 diye');
  assert.equal(b.kind, 'payment');
  assert.equal(b.paid, 400);
});

test('missing customer and missing payment are flagged, not guessed', () => {
  const r = parse('20 kg onion at 30');
  assert.equal(r.customer, '');
  assert.equal(r.confidence, 'check');
  assert.ok(r.warnings.some((w) => /customer/i.test(w)));
  assert.ok(r.warnings.some((w) => /No payment/i.test(w)));
  assert.equal(r.paid, 0);
});

test('overpayment is flagged', () => {
  const r = parse('Asha took 1 kg tea at 400, paid 500');
  assert.equal(r.paid, 500);
  assert.equal(r.due, 0);
  assert.ok(r.warnings.some((w) => /more than the total/i.test(w)));
});

test('empty and junk input never throws', () => {
  for (const input of ['', '   ', null, undefined, ',,,', 'hello there', '!!!', 12345]) {
    const r = parse(input);
    assert.ok(Array.isArray(r.items));
    assert.ok(Array.isArray(r.warnings));
  }
});
