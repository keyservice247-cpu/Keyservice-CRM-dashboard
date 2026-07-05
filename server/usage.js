// Houdt het AI-verbruik bij dat via dít dashboard loopt (aantal aanroepen +
// tokens), met een kostenschatting PER MODEL. Dit is een indicatie — de officiële
// kosten zie je altijd in de Claude Console.
import { db, saveSoon } from './db.js';

// Prijsindicatie per 1M tokens (USD), per modeltier. Overschrijfbaar via env.
// Standaarden: Haiku 4.5 ~ $1/$5, Sonnet 5 ~ $3/$15, Opus ~ $15/$75.
const PRICES = {
  haiku: { in: Number(process.env.AI_PRICE_HAIKU_IN || 1.0), out: Number(process.env.AI_PRICE_HAIKU_OUT || 5.0) },
  sonnet: { in: Number(process.env.AI_PRICE_SONNET_IN || 3.0), out: Number(process.env.AI_PRICE_SONNET_OUT || 15.0) },
  opus: { in: Number(process.env.AI_PRICE_OPUS_IN || 15.0), out: Number(process.env.AI_PRICE_OPUS_OUT || 75.0) },
  overig: { in: Number(process.env.AI_PRICE_IN || 3.0), out: Number(process.env.AI_PRICE_OUT || 15.0) },
};

function tierOf(model) {
  const m = String(model || '').toLowerCase();
  if (m.includes('haiku')) return 'haiku';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('opus')) return 'opus';
  return 'overig';
}

function bucket() {
  const u = db().usage || (db().usage = {});
  const month = new Date().toISOString().slice(0, 7); // "2026-06"
  if (!u[month]) u[month] = { calls: 0, inputTokens: 0, outputTokens: 0, byModel: {} };
  if (!u[month].byModel) u[month].byModel = {};
  return { u, month };
}

export function recordAIUsage(usageObj = {}, model = '') {
  const { u, month } = bucket();
  const inp = Number(usageObj.input_tokens || 0);
  const out = Number(usageObj.output_tokens || 0);
  u[month].calls += 1;
  u[month].inputTokens += inp;
  u[month].outputTokens += out;
  const tier = tierOf(model);
  const bm = u[month].byModel[tier] || (u[month].byModel[tier] = { calls: 0, inputTokens: 0, outputTokens: 0 });
  bm.calls += 1;
  bm.inputTokens += inp;
  bm.outputTokens += out;
  saveSoon();
}

function costOf(b, tier) {
  const p = PRICES[tier] || PRICES.overig;
  return (b.inputTokens / 1e6) * p.in + (b.outputTokens / 1e6) * p.out;
}

export function usageSummary() {
  const u = db().usage || {};
  const month = new Date().toISOString().slice(0, 7);
  const cur = u[month] || { calls: 0, inputTokens: 0, outputTokens: 0, byModel: {} };
  const byModel = cur.byModel || {};
  let estCost = 0;
  const perModel = [];
  if (Object.keys(byModel).length) {
    for (const [tier, b] of Object.entries(byModel)) {
      const c = costOf(b, tier);
      estCost += c;
      perModel.push({ tier, calls: b.calls, inputTokens: b.inputTokens, outputTokens: b.outputTokens, estCostUsd: Math.round(c * 100) / 100 });
    }
    perModel.sort((a, b) => b.estCostUsd - a.estCostUsd);
  } else {
    // Oude data zonder model-uitsplitsing: reken voorzichtig met de duurdere prijs.
    estCost = costOf(cur, 'overig');
  }
  return {
    month,
    calls: cur.calls,
    inputTokens: cur.inputTokens,
    outputTokens: cur.outputTokens,
    estimatedCostUsd: Math.round(estCost * 100) / 100,
    perModel,
    history: u,
  };
}
