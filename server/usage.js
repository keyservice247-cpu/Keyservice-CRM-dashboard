// Houdt het AI-verbruik bij dat via dít dashboard loopt (aantal aanroepen +
// tokens), met een ruwe kostenschatting. Dit is een indicatie — de officiële
// kosten zie je altijd in de Claude Console.
import { db, saveSoon } from './db.js';

// Globale prijsindicatie per 1M tokens (USD) voor Haiku-achtige modellen.
// Pas aan als je een ander model gebruikt.
const PRICE_IN_PER_M = Number(process.env.AI_PRICE_IN || 1.0);
const PRICE_OUT_PER_M = Number(process.env.AI_PRICE_OUT || 5.0);

function bucket() {
  const u = db().usage || (db().usage = {});
  const month = new Date().toISOString().slice(0, 7); // "2026-06"
  if (!u[month]) u[month] = { calls: 0, inputTokens: 0, outputTokens: 0 };
  return { u, month };
}

export function recordAIUsage(usageObj = {}) {
  const { u, month } = bucket();
  u[month].calls += 1;
  u[month].inputTokens += Number(usageObj.input_tokens || 0);
  u[month].outputTokens += Number(usageObj.output_tokens || 0);
  saveSoon();
}

export function usageSummary() {
  const u = db().usage || {};
  const month = new Date().toISOString().slice(0, 7);
  const cur = u[month] || { calls: 0, inputTokens: 0, outputTokens: 0 };
  const estCost = (cur.inputTokens / 1e6) * PRICE_IN_PER_M + (cur.outputTokens / 1e6) * PRICE_OUT_PER_M;
  return {
    month,
    calls: cur.calls,
    inputTokens: cur.inputTokens,
    outputTokens: cur.outputTokens,
    estimatedCostUsd: Math.round(estCost * 100) / 100,
    history: u,
  };
}
