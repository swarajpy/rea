/*
 * rea parser: turns one spoken or typed sentence into a structured bill.
 *
 *   "Sharma ji took 20 kg onion at 30, paid 400"
 *   -> customer "Sharma ji", 1 item (onion, 20 kg x 30 = 600), total 600, paid 400, due 200
 *
 * It understands English, Hindi and Marathi in Latin or Devanagari script, mixed
 * freely. It is rule based, runs fully offline and never throws: anything it is
 * unsure about is reported in `warnings` so the UI can ask the shopkeeper to check.
 *
 * Works in the browser (window.ReaParser) and in Node (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReaParser = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Lexicon                                                            */
  /* ------------------------------------------------------------------ */

  const NUM = new Map();
  const MULT = new Map();
  const UNITS = new Map();
  const def = (map, words, value) => words.split(/\s+/).forEach((w) => map.set(w, value));

  // Number words. Digits are what speech engines usually return, but typed
  // text and some engines give words, so the common ones are covered.
  def(NUM, 'zero', 0);
  def(NUM, 'one ek एक', 1);
  def(NUM, 'two do don दो दोन', 2);
  def(NUM, 'three teen तीन', 3);
  def(NUM, 'four char chaar चार', 4);
  def(NUM, 'five paanch panch pach पाच पांच पाँच', 5);
  def(NUM, 'six chhe chah saha सहा छह', 6);
  def(NUM, 'seven saat sat सात', 7);
  def(NUM, 'eight aath aat आठ', 8);
  def(NUM, 'nine nau नऊ नौ', 9);
  def(NUM, 'ten das daha दस दहा', 10);
  def(NUM, 'eleven gyarah', 11);
  def(NUM, 'twelve barah', 12);
  def(NUM, 'thirteen terah', 13);
  def(NUM, 'fourteen chaudah', 14);
  def(NUM, 'fifteen pandrah', 15);
  def(NUM, 'sixteen solah', 16);
  def(NUM, 'seventeen satrah', 17);
  def(NUM, 'eighteen atharah', 18);
  def(NUM, 'nineteen unnis', 19);
  def(NUM, 'twenty bees vees बीस वीस', 20);
  def(NUM, 'thirty tees tis तीस', 30);
  def(NUM, 'forty chalis चालीस', 40);
  def(NUM, 'fifty pachas pannas पचास पन्नास', 50);
  def(NUM, 'sixty saath साठ', 60);
  def(NUM, 'seventy sattar सत्तर', 70);
  def(NUM, 'eighty assi अस्सी ऐंशी', 80);
  def(NUM, 'ninety nabbe नब्बे', 90);
  // Fractions shopkeepers actually say
  def(NUM, 'half aadha adha ardha आधा अर्धा', 0.5);
  def(NUM, 'dedh डेढ़ डेढ', 1.5);
  def(NUM, 'dhai adhai ढाई', 2.5);
  def(NUM, 'sawa सवा', 1.25);
  def(NUM, 'paun पौन', 0.75);
  def(MULT, 'hundred sau shambhar सौ शंभर', 100);
  def(MULT, 'thousand hazaar hazar हजार हज़ार', 1000);

  // Units -> canonical unit
  def(UNITS, 'kg kgs kilo kilos kilogram kilograms किलो केजी', 'kg');
  def(UNITS, 'g gm gms gram grams ग्राम', 'g');
  def(UNITS, 'l ltr litre litres liter liters लिटर', 'l');
  def(UNITS, 'ml', 'ml');
  def(UNITS, 'dozen dz darjan dazan दर्जन डझन', 'dozen');
  def(UNITS, 'pcs pc piece pieces nag नग', 'pc');
  def(UNITS, 'packet packets pkt पैकेट पाकीट', 'packet');
  def(UNITS, 'bag bags बोरी', 'bag');
  def(UNITS, 'box boxes', 'box');
  def(UNITS, 'bottle bottles बाटली बोतल', 'bottle');
  def(UNITS, 'meter metre meters metres mtr मीटर', 'm');

  const set = (words) => new Set(words.split(/\s+/));

  // Words that separate "who" from "what they bought".
  const CUSTOMER_VERBS = set(
    'took bought buy purchased ordered wants ne ni nni ko ghetla ghetle ghetli ghetlay liya liye kharida kharidi kharide le ' +
      'लिया लिये घेतला घेतले घेतली ने नी को खरीदा खरीदी ' +
      'paid pays pay gave received'
  );

  // Payment vocabulary. PAID_LEFT words come after the amount ("400 diye").
  const PAID_WORDS = set(
    'paid pay pays payed gave given received advance deposit deposited cash jama diye diya diyi dile dilet dila dilya ' +
      'दिए दिये दिया दिले दिलेत दिला जमा नगद'
  );
  const PAID_LEFT = set('diye diya diyi dile dilet dila dilya दिए दिये दिया दिले दिलेत दिला');
  const PAID_NOT_FULL = set('advance deposit deposited jama जमा'); // "advance" alone does not mean paid in full
  const DUE_WORDS = set('baki baaki bakki balance due pending बाकी बाकि शिल्लक');
  const CREDIT_WORDS = set('udhar udhaar udhari credit उधार उधारी');

  const ITEM_SEPARATORS = set(', ; : + and aur ani और आणि व');
  const SEPARATORS = set(', ; : +');

  // Filler that is never part of an item name.
  const STOP = set(
    'rs at @ per each rate ka ki ke cha chi che of x for total kul ne ni took bought gaya gayi gaye liya liye le ' +
      'ghetla ghetle ghetli ghetlay dar bhav bhaav daam price pe se me mein a an the is in full all pura poora sab sagla sagle only just ' +
      'का की के चा ची चे रेट भाव दर ने नी लिया घेतला घेतले घेतली गया पूरा सब सगळे'
  );

  /* ------------------------------------------------------------------ */
  /* Helpers                                                            */
  /* ------------------------------------------------------------------ */

  const round2 = (n) => Math.round(n * 100) / 100;
  const round3 = (n) => Math.round(n * 1000) / 1000;
  const isNumTok = (t) => typeof t === 'string' && /^\d+(\.\d+)?$/.test(t);

  function normalize(input) {
    let s = String(input == null ? '' : input).normalize('NFC').toLowerCase();
    s = s
      // Devanagari digits -> ASCII
      .replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966))
      // currency markers -> "rs"
      .replace(/₹/g, ' rs ')
      .replace(/(^|[^a-z])(?:rs|inr)\.?(?![a-z])/g, '$1 rs ')
      .replace(/\b(?:rupees?|rupaye|rupaya|rupay|rupiye)\b/g, ' rs ')
      .replace(/(?:रुपये|रुपया|रुपए|रु)\.?(?![\p{L}\p{M}])/gu, ' rs ')
      // 1,00,000 and 1,000 -> plain digits
      .replace(/(\d),(\d{2}),(\d{3})(?!\d)/g, '$1$2$3')
      .replace(/(\d),(\d{3})(?!\d)/g, '$1$2')
      .replace(/(\d),(\d{3})(?!\d)/g, '$1$2')
      .replace(/@/g, ' @ ')
      // "20kg" -> "20 kg"
      .replace(/(\d)(\p{L})/gu, '$1 $2')
      .replace(/(\p{L})(\d)/gu, '$1 $2');
    return s;
  }

  function tokenize(text) {
    const raw = text.match(/[\p{L}\p{M}\p{N}@.]+|[,;:+]/gu) || [];
    return raw.map((t) => t.replace(/^\.+|\.+$/g, '')).filter(Boolean);
  }

  function titleCase(word) {
    return /^[a-z]/.test(word) ? word[0].toUpperCase() + word.slice(1) : word;
  }

  function formatName(tokens) {
    return tokens.map((t) => (t === 'ji' ? 'ji' : titleCase(t))).join(' ');
  }

  /* ------------------------------------------------------------------ */
  /* Number words -> digits                                             */
  /* ------------------------------------------------------------------ */

  function convertNumberWords(tokens) {
    const out = [];
    let i = 0;
    while (i < tokens.length) {
      if (!NUM.has(tokens[i]) && !MULT.has(tokens[i])) {
        out.push(tokens[i]);
        i++;
        continue;
      }
      let total = 0;
      let current = 0;
      let prev = null;
      let sawMult = false;
      let j = i;
      while (j < tokens.length) {
        const w = tokens[j];
        if (NUM.has(w)) {
          const v = NUM.get(w);
          const joins =
            prev === null ||
            prev.kind === 'mult' ||
            (prev.kind === 'num' && prev.v >= 20 && prev.v % 10 === 0 && Number.isInteger(v) && v >= 1 && v <= 9);
          if (!joins) break;
          current += v;
          prev = { kind: 'num', v };
        } else if (MULT.has(w)) {
          if (prev && prev.kind === 'mult') break;
          const m = MULT.get(w);
          if (m === 100) {
            current = (current || 1) * 100;
          } else {
            total += (current || 1) * m;
            current = 0;
          }
          prev = { kind: 'mult', v: m };
          sawMult = true;
        } else if (w === 'and' && sawMult && j + 1 < tokens.length && NUM.has(tokens[j + 1])) {
          j++;
          continue;
        } else {
          break;
        }
        j++;
      }
      out.push(String(total + current));
      i = j;
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Customer                                                           */
  /* ------------------------------------------------------------------ */

  function extractCustomer(tokens) {
    const startsWithDigit = (t) => /^\d/.test(t);
    let i = 0;
    let lead = false;
    const firstTwo = tokens.slice(0, 2).join(' ');
    if (['sold to', 'sale to', 'bill for', 'bill to'].includes(firstTwo)) {
      i = 2;
      lead = true;
    } else if (['to', 'for', 'customer'].includes(tokens[0])) {
      i = 1;
      lead = true;
    }

    if (lead) {
      let j = i;
      while (j < tokens.length && j - i < 4 && !startsWithDigit(tokens[j]) && !SEPARATORS.has(tokens[j]) && !CUSTOMER_VERBS.has(tokens[j])) j++;
      const name = tokens.slice(i, j);
      let k = j;
      if (CUSTOMER_VERBS.has(tokens[k]) && !PAID_WORDS.has(tokens[k])) k++;
      if (SEPARATORS.has(tokens[k])) k++;
      return { customer: formatName(name), rest: tokens.slice(k) };
    }

    const limit = Math.min(tokens.length, 6);
    for (let j = 0; j < limit; j++) {
      const t = tokens[j];
      if (startsWithDigit(t) || SEPARATORS.has(t)) break;
      if (CUSTOMER_VERBS.has(t)) {
        if (j === 0) break;
        // keep payment verbs ("Sharma ji paid 400") so the payment step can see them
        const rest = PAID_WORDS.has(t) ? tokens.slice(j) : tokens.slice(j + 1);
        return { customer: formatName(tokens.slice(0, j)), rest };
      }
    }
    return { customer: '', rest: tokens };
  }

  /* ------------------------------------------------------------------ */
  /* Payments                                                           */
  /* ------------------------------------------------------------------ */

  function extractPayments(tokens) {
    const used = new Array(tokens.length).fill(false);
    const result = { paid: null, due: null, paidAll: false, onCredit: false };

    const atBoundary = (idx) => idx <= 0 || SEPARATORS.has(tokens[idx - 1]);

    function numRight(i) {
      let j = i + 1;
      while (tokens[j] === 'rs') j++;
      return isNumTok(tokens[j]) && !used[j] ? j : -1;
    }
    function numLeft(i, needBoundary) {
      let j = i - 1;
      while (j >= 0 && tokens[j] === 'rs') j--;
      if (j < 0 || !isNumTok(tokens[j]) || used[j]) return -1;
      if (needBoundary && !atBoundary(j)) return -1;
      return j;
    }
    function consume(a, b) {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      for (let k = lo; k <= hi; k++) used[k] = true;
    }

    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (used[i]) continue;

      if (PAID_WORDS.has(t)) {
        const leftFirst = PAID_LEFT.has(t);
        let j = leftFirst ? numLeft(i, false) : numRight(i);
        if (j < 0) j = leftFirst ? numRight(i) : numLeft(i, true);
        if (j >= 0) {
          result.paid = round2((result.paid || 0) + parseFloat(tokens[j]));
          consume(i, j);
        } else {
          if (!PAID_NOT_FULL.has(t)) result.paidAll = true;
          used[i] = true;
        }
      } else if (DUE_WORDS.has(t)) {
        let j = numRight(i);
        if (j < 0) j = numLeft(i, true);
        if (j >= 0) {
          result.due = round2(parseFloat(tokens[j]));
          consume(i, j);
        } else {
          used[i] = true;
        }
      } else if (CREDIT_WORDS.has(t)) {
        result.onCredit = true;
        const j = numRight(i);
        if (j >= 0) {
          result.due = round2(parseFloat(tokens[j]));
          consume(i, j);
        } else {
          used[i] = true;
        }
      }
    }

    result.tokens = tokens.filter((_, idx) => !used[idx]);
    return result;
  }

  /* ------------------------------------------------------------------ */
  /* Items                                                              */
  /* ------------------------------------------------------------------ */

  function splitChunks(tokens) {
    const chunks = [];
    let cur = [];
    for (const t of tokens) {
      if (ITEM_SEPARATORS.has(t)) {
        if (cur.length) chunks.push(cur);
        cur = [];
      } else {
        cur.push(t);
      }
    }
    if (cur.length) chunks.push(cur);
    return chunks;
  }

  function parseItem(chunk, warnings) {
    let unit = null;
    let totalWord = false;
    const nums = [];
    const nameParts = [];
    let firstNameIdx = -1;

    chunk.forEach((t, idx) => {
      if (isNumTok(t)) nums.push({ v: parseFloat(t), idx });
      else if (UNITS.has(t)) {
        if (!unit) unit = UNITS.get(t);
      } else if (t === 'for' || t === 'total' || t === 'kul') totalWord = true;
      else if (STOP.has(t)) {
        /* filler */
      } else {
        nameParts.push(t);
        if (firstNameIdx < 0) firstNameIdx = idx;
      }
    });

    if (!nameParts.length && nums.length < 2) return null; // stray leftovers

    const name = nameParts.length ? titleCase(nameParts.join(' ')) : 'Item';
    if (!nameParts.length) warnings.push('One item has no name — please fill it in.');

    let qty = 1;
    let rate = null;
    let amount = null;

    if (nums.length === 0) {
      warnings.push(`No quantity or price heard for ${name}.`);
    } else if (nums.length === 1) {
      const n = nums[0];
      if (totalWord) {
        amount = n.v;
      } else if (n.idx < firstNameIdx || (firstNameIdx < 0 && unit)) {
        qty = n.v; // "3 soap" / "2 kg"
        warnings.push(`No price heard for ${name}.`);
      } else if (unit) {
        qty = n.v;
        warnings.push(`No price heard for ${name}.`);
      } else {
        rate = n.v; // "onion 30" -> one piece at 30
        warnings.push(`Assumed quantity 1 for ${name}.`);
      }
    } else {
      if (nums.length > 2) warnings.push(`Heard extra numbers for ${name}; used the first two.`);
      qty = nums[0].v;
      if (totalWord) amount = nums[1].v;
      else rate = nums[1].v;
    }

    if (amount != null) {
      rate = qty ? round2(amount / qty) : amount;
    }

    // "500 g sugar at 45" means 0.5 kg at 45 per kg
    if (rate != null && (unit === 'g' || unit === 'ml')) {
      qty = qty / 1000;
      unit = unit === 'g' ? 'kg' : 'l';
    }

    if (amount == null && rate != null) amount = round2(qty * rate);

    return { name, qty: round3(qty), unit: unit || '', rate, amount };
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                         */
  /* ------------------------------------------------------------------ */

  function parse(input) {
    const warnings = [];
    const blank = { kind: 'sale', customer: '', items: [], total: 0, paid: 0, due: 0, warnings, confidence: 'check' };

    const text = normalize(input);
    const allTokens = tokenize(text);
    if (!allTokens.length) {
      warnings.push('Nothing to read yet — say or type a sale.');
      return blank;
    }

    const { customer, rest } = extractCustomer(allTokens);
    const pay = extractPayments(convertNumberWords(rest));
    const items = splitChunks(pay.tokens)
      .map((c) => parseItem(c, warnings))
      .filter(Boolean);

    const total = round2(items.reduce((sum, it) => sum + (it.amount || 0), 0));

    // A bare "Sharma ji paid 400" is a payment, not a sale.
    if (!items.length && pay.paid > 0) {
      if (!customer) warnings.push('Who paid? Customer name not heard.');
      return { kind: 'payment', customer, items: [], total: 0, paid: pay.paid, due: 0, warnings, confidence: customer ? 'high' : 'check' };
    }

    if (!items.length) warnings.push('Could not find any items in that.');
    if (!customer) warnings.push('Customer name not heard — saved as Walk-in unless you type one.');

    let paid;
    if (pay.paid !== null) paid = pay.paid;
    else if (pay.onCredit) paid = 0;
    else if (pay.paidAll) paid = total;
    else if (pay.due !== null) paid = Math.max(0, round2(total - pay.due));
    else {
      paid = 0;
      if (items.length) warnings.push('No payment mentioned — marked unpaid.');
    }

    const due = Math.max(0, round2(total - paid));
    if (paid > total && items.length) warnings.push('Paid is more than the total — the extra is kept as advance.');
    if (pay.paid !== null && pay.due !== null && Math.abs(pay.due - due) > 0.01) {
      warnings.push('Paid and balance do not add up to the total — please check.');
    }

    const clean = items.every((it) => it.rate != null && it.name !== 'Item');
    const confidence = customer && items.length && clean && !warnings.length ? 'high' : 'check';

    return { kind: 'sale', customer, items, total, paid, due, warnings, confidence };
  }

  return { parse, normalize, tokenize, convertNumberWords };
});
