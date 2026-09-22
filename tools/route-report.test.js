'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  collectUsageRecords,
  filterSince,
  computeCost,
  normalizeModelId,
  aggregateByModel,
  counterfactual,
  splitCost,
  buildCounterfactualReport,
  buildReport,
  NO_MODEL_LABEL,
  BASELINE_MODEL,
} = require('./route-report.js');

function assistantLine({ requestId, model, timestamp, isSidechain, usage, extraUsageFields }) {
  return JSON.stringify({
    type: 'assistant',
    isSidechain: !!isSidechain,
    requestId,
    timestamp,
    message: {
      model,
      usage: Object.assign(
        {
          input_tokens: usage.input || 0,
          cache_creation_input_tokens: usage.cacheWrite || 0,
          cache_read_input_tokens: usage.cacheRead || 0,
          output_tokens: usage.output || 0,
        },
        extraUsageFields || {}
      ),
    },
  });
}

test('dedupe: duas linhas com o mesmo requestId contam uma vez', () => {
  const line = assistantLine({
    requestId: 'req_1',
    model: 'claude-sonnet-5',
    timestamp: '2026-09-01T00:00:00Z',
    usage: { input: 10, output: 5 },
  });
  const { records, discarded } = collectUsageRecords([line, line]);
  assert.equal(records.length, 1);
  assert.equal(discarded, 0);
});

test('linha JSON invalida nao derruba a execucao e e contabilizada como descartada', () => {
  const good = assistantLine({
    requestId: 'req_1',
    model: 'claude-sonnet-5',
    timestamp: '2026-09-01T00:00:00Z',
    usage: { input: 10, output: 5 },
  });
  const { records, discarded } = collectUsageRecords([good, '{isso nao e json valido', '']);
  assert.equal(records.length, 1);
  assert.equal(discarded, 1);
});

test('linha type "user" e ignorada', () => {
  const userLine = JSON.stringify({ type: 'user', requestId: 'req_9', message: { role: 'user', content: 'oi' } });
  const { records } = collectUsageRecords([userLine]);
  assert.equal(records.length, 0);
});

test('usage.iterations NAO e somado', () => {
  const line = assistantLine({
    requestId: 'req_1',
    model: 'claude-haiku-4-5',
    timestamp: '2026-09-01T00:00:00Z',
    usage: { input: 1000, output: 1000 },
    extraUsageFields: {
      iterations: [
        { input_tokens: 1000, output_tokens: 1000 },
        { input_tokens: 1000, output_tokens: 1000 },
      ],
    },
  });
  const { records } = collectUsageRecords([line]);
  assert.equal(records[0].usage.input, 1000);
  assert.equal(records[0].usage.output, 1000);
});

test('precificacao: numeros redondos batem com o valor calculado a mao', () => {
  // claude-sonnet-5: in 2, out 10, cacheWrite 2.50, cacheRead 0.20 (por 1M tokens)
  // 1M de cada campo -> 2 + 2.5 + 0.2 + 10 = 14.7
  const cost = computeCost('claude-sonnet-5', {
    input: 1_000_000,
    cacheWrite: 1_000_000,
    cacheRead: 1_000_000,
    output: 1_000_000,
  });
  assert.equal(Math.round(cost * 100) / 100, 14.7);
});

test('modelo desconhecido: tokens contados, custo null, nome na lista de sem-preco', () => {
  const line = assistantLine({
    requestId: 'req_1',
    model: 'gpt-5.6-terra',
    timestamp: '2026-09-01T00:00:00Z',
    usage: { input: 500, output: 200 },
  });
  const { records } = collectUsageRecords([line]);
  const { byModel, unpricedModels } = aggregateByModel(records);
  const totals = byModel.get('gpt-5.6-terra');
  assert.equal(totals.input, 500);
  assert.equal(totals.output, 200);
  assert.equal(totals.costKnown, false);
  assert.ok(unpricedModels.has('gpt-5.6-terra'));
});

test('modelo ausente vira "(sem modelo)" e nao e cobrado', () => {
  const line = assistantLine({
    requestId: 'req_1',
    model: null,
    timestamp: '2026-09-01T00:00:00Z',
    usage: { input: 10, output: 10 },
  });
  const { records } = collectUsageRecords([line]);
  assert.equal(records[0].model, NO_MODEL_LABEL);
  const { byModel } = aggregateByModel(records);
  assert.equal(byModel.get(NO_MODEL_LABEL).cost, 0);
});

test('contrafactual: cenario haiku + opus com economia esperada conhecida (top == baseline)', () => {
  const haikuLine = assistantLine({
    requestId: 'req_h',
    model: 'claude-haiku-4-5',
    timestamp: '2026-09-01T00:00:00Z',
    usage: { input: 1_000_000, output: 1_000_000 },
  });
  const opusLine = assistantLine({
    requestId: 'req_o',
    model: 'claude-opus-5',
    timestamp: '2026-09-02T00:00:00Z',
    usage: { input: 1_000_000, output: 1_000_000 },
  });
  const { records } = collectUsageRecords([haikuLine, opusLine]);
  const { byModel } = aggregateByModel(records);
  const cf = buildCounterfactualReport(byModel);

  // haiku: 1*1 + 5*1 = 6 | opus: 5*1 + 25*1 = 30 | real = 36
  assert.equal(Math.round(cf.realCost * 100) / 100, 36);
  assert.equal(cf.top.model, 'claude-opus-5');
  // contrafactual: 2M input + 2M output, tudo em opus -> 10 + 50 = 60
  assert.equal(Math.round(cf.top.cost * 100) / 100, 60);
  assert.equal(Math.round(cf.top.savings * 100) / 100, 24);
  assert.equal(Math.round(cf.top.savingsPct * 10) / 10, 40);
  // baseline == opus-5 aqui, entao os numeros batem com o top
  assert.equal(cf.baseline.model, BASELINE_MODEL);
  assert.equal(Math.round(cf.baseline.cost * 100) / 100, 60);
});

test('dois contrafactuais: teto teorico (fable-5-1) difere do baseline realista (opus-5)', () => {
  const fableLine = assistantLine({
    requestId: 'req_f',
    model: 'claude-fable-5-1',
    timestamp: '2026-09-01T00:00:00Z',
    usage: { input: 100_000, output: 100_000 },
  });
  const haikuLine = assistantLine({
    requestId: 'req_h',
    model: 'claude-haiku-4-5',
    timestamp: '2026-09-02T00:00:00Z',
    usage: { input: 200_000, output: 200_000 },
  });
  const { records } = collectUsageRecords([fableLine, haikuLine]);
  const { byModel } = aggregateByModel(records);
  const cf = buildCounterfactualReport(byModel);

  // fable-5-1: 0.1*10 + 0.1*50 = 6 | haiku: 0.2*1 + 0.2*5 = 1.2 | real = 7.2
  assert.equal(Math.round(cf.realCost * 100) / 100, 7.2);

  // top = fable-5-1 (maior soma de precos unitarios entre os que apareceram)
  assert.equal(cf.top.model, 'claude-fable-5-1');
  // 0.3M input + 0.3M output em fable-5-1 -> 0.3*10 + 0.3*50 = 18
  assert.equal(Math.round(cf.top.cost * 100) / 100, 18);
  assert.equal(Math.round(cf.top.savings * 100) / 100, 10.8);
  assert.equal(Math.round(cf.top.savingsPct * 10) / 10, 60);

  // baseline = opus-5, mesmo sem aparecer nos dados
  assert.equal(cf.baseline.model, 'claude-opus-5');
  // 0.3M input + 0.3M output em opus-5 -> 0.3*5 + 0.3*25 = 9
  assert.equal(Math.round(cf.baseline.cost * 100) / 100, 9);
  assert.equal(Math.round(cf.baseline.savings * 100) / 100, 1.8);
  assert.equal(Math.round(cf.baseline.savingsPct * 10) / 10, 20);
});

test('counterfactual(totals, modelId): funcao pura, numeros conferidos a mao', () => {
  const totals = { input: 1_000_000, cacheWrite: 1_000_000, cacheRead: 1_000_000, output: 1_000_000 };
  // claude-sonnet-5: 2 + 2.5 + 0.2 + 10 = 14.7
  assert.equal(Math.round(counterfactual(totals, 'claude-sonnet-5') * 100) / 100, 14.7);
  // modelo sem preco -> null
  assert.equal(counterfactual(totals, 'gpt-5.6-terra'), null);
});

test('normalizeModelId: remove sufixo -YYYYMMDD e precifica igual ao modelo base', () => {
  assert.equal(normalizeModelId('claude-haiku-4-5-20251001'), 'claude-haiku-4-5');
  // modelo desconhecido com sufixo de data continua sem preco (sem fuzzy match)
  assert.equal(computeCost('claude-opus-9-20260101', { input: 1000, cacheWrite: 0, cacheRead: 0, output: 1000 }), null);

  const usage = { input: 1_000_000, cacheWrite: 0, cacheRead: 0, output: 1_000_000 };
  const withSuffix = computeCost('claude-haiku-4-5-20251001', usage);
  const base = computeCost('claude-haiku-4-5', usage);
  assert.equal(withSuffix, base);
  assert.equal(Math.round(withSuffix * 100) / 100, 6); // 1*1 + 1*5
});

test('eventos sinteticos do harness (<synthetic>) sao descartados a parte, fora de sem-preco', () => {
  const syntheticLine = assistantLine({
    requestId: 'req_syn',
    model: '<synthetic>',
    timestamp: '2026-09-01T00:00:00Z',
    usage: { input: 0, output: 0 },
  });
  const { records, syntheticSkipped, discarded } = collectUsageRecords([syntheticLine]);
  assert.equal(records.length, 0);
  assert.equal(syntheticSkipped, 1);
  assert.equal(discarded, 0);

  const report = buildReport([syntheticLine], {}, { filesRead: 1 });
  assert.equal(report.footer.syntheticSkipped, 1);
  assert.deepEqual(report.footer.unpricedModels, []);
});

test('--since exclui evento anterior a data', () => {
  const oldLine = { requestId: 'req_old', timestamp: '2026-01-01T00:00:00Z', model: 'x', usage: {} };
  const newLine = { requestId: 'req_new', timestamp: '2026-09-01T00:00:00Z', model: 'x', usage: {} };
  const filtered = filterSince([oldLine, newLine], '2026-06-01');
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].requestId, 'req_new');
});

test('buildReport: fluxo completo nao lanca e reporta rodape coerente', () => {
  const lines = [
    assistantLine({ requestId: 'req_1', model: 'claude-sonnet-5', timestamp: '2026-09-01T00:00:00Z', usage: { input: 10, output: 5 } }),
    assistantLine({ requestId: 'req_1', model: 'claude-sonnet-5', timestamp: '2026-09-01T00:00:00Z', usage: { input: 10, output: 5 } }),
    '{linha invalida',
    JSON.stringify({ type: 'user', requestId: 'req_2', message: { role: 'user', content: 'oi' } }),
  ];
  const report = buildReport(lines, {}, { filesRead: 1 });
  assert.equal(report.footer.eventsCounted, 1);
  assert.equal(report.footer.discardedLines, 1);
  assert.equal(report.modelRows.length, 1);
  assert.equal(report.modelRows[0].model, 'claude-sonnet-5');
});

test('splitCost(totals, modelId): decompoe contexto (input+cache) e geracao (output), numeros conferidos a mao', () => {
  const totals = { input: 1_000_000, cacheWrite: 1_000_000, cacheRead: 1_000_000, output: 1_000_000 };
  // claude-sonnet-5: contexto = 2 + 2.5 + 0.2 = 4.7 | geracao = 10
  const { context, generation } = splitCost(totals, 'claude-sonnet-5');
  assert.equal(Math.round(context * 100) / 100, 4.7);
  assert.equal(Math.round(generation * 100) / 100, 10);
  assert.equal(Math.round((context + generation) * 100) / 100, 14.7);
  assert.equal(Math.round((context + generation) * 100) / 100, Math.round(counterfactual(totals, 'claude-sonnet-5') * 100) / 100);
});

test('splitCost: modelo sem preco devolve null nos dois campos', () => {
  const totals = { input: 1000, cacheWrite: 0, cacheRead: 0, output: 1000 };
  const { context, generation } = splitCost(totals, 'gpt-5.6-terra');
  assert.equal(context, null);
  assert.equal(generation, null);
});

test('buildReport: costSplit.context + costSplit.generation bate com totalCost; modelo sem preco fica fora do total', () => {
  const lines = [
    assistantLine({ requestId: 'req_a', model: 'claude-sonnet-5', timestamp: '2026-09-01T00:00:00Z', usage: { input: 1_000_000, cacheWrite: 1_000_000, cacheRead: 1_000_000, output: 1_000_000 } }),
    assistantLine({ requestId: 'req_b', model: 'claude-opus-5', timestamp: '2026-09-01T00:00:00Z', usage: { input: 500_000, output: 500_000 } }),
    assistantLine({ requestId: 'req_c', model: 'gpt-5.6-terra', timestamp: '2026-09-01T00:00:00Z', usage: { input: 1000, output: 1000 } }),
  ];
  const report = buildReport(lines, {}, { filesRead: 1 });

  const sonnetRow = report.modelRows.find((r) => r.model === 'claude-sonnet-5');
  assert.equal(Math.round(sonnetRow.contextCost * 100) / 100, 4.7);
  assert.equal(Math.round(sonnetRow.generationCost * 100) / 100, 10);

  const unpricedRow = report.modelRows.find((r) => r.model === 'gpt-5.6-terra');
  assert.equal(unpricedRow.contextCost, null);
  assert.equal(unpricedRow.generationCost, null);

  const sumSplit = report.costSplit.context + report.costSplit.generation;
  assert.equal(Math.round(sumSplit * 100) / 100, Math.round(report.totalCost * 100) / 100);
});
