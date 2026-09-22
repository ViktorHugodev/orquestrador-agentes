#!/usr/bin/env node
'use strict';

// route-report.js
// Varre transcripts JSONL do Claude Code (~/.claude/projects/**/*.jsonl) e produz
// um relatorio de gasto por modelo + a economia do roteamento multi-modelo versus
// rodar tudo num modelo de referencia.
//
// IMPORTANTE: o contrafactual compara precificacao dos MESMOS tokens em outro
// modelo - nao e uma simulacao de qualidade equivalente. O mesmo prompt nao
// gera necessariamente o mesmo numero de tokens em modelos diferentes.
//
// Uso: node tools/route-report.js [--dir <caminho>] [--since YYYY-MM-DD] [--json]

const fs = require('fs');
const path = require('path');
const os = require('os');

// Precos publicos da API da Anthropic (USD por 1M tokens), consultados em 2026-09-22.
// Modelo fora desta tabela: tokens sao contados, custo fica null, nome entra em
// "modelos sem preco" no rodape do relatorio. Nunca chutar preco.
const PRICES = {
  'claude-fable-5-1': { in: 10, out: 50, cacheWrite: 12.50, cacheRead: 0.25 },
  'claude-fable-5': { in: 10, out: 50, cacheWrite: 12.50, cacheRead: 1.00 },
  'claude-opus-5': { in: 5, out: 25, cacheWrite: 6.25, cacheRead: 0.50 },
  'claude-opus-4-8': { in: 5, out: 25, cacheWrite: 6.25, cacheRead: 0.50 },
  'claude-opus-4-7': { in: 5, out: 25, cacheWrite: 6.25, cacheRead: 0.50 },
  'claude-opus-4-6': { in: 5, out: 25, cacheWrite: 6.25, cacheRead: 0.50 },
  'claude-sonnet-5': { in: 2, out: 10, cacheWrite: 2.50, cacheRead: 0.20 },
  'claude-sonnet-4-6': { in: 3, out: 15, cacheWrite: 3.75, cacheRead: 0.30 },
  'claude-haiku-4-5': { in: 1, out: 5, cacheWrite: 1.25, cacheRead: 0.10 },
};

const NO_MODEL_LABEL = '(sem modelo)';

// Modelo de referencia para o contrafactual "baseline realista": e o default
// plausivel de quem nao roteia por custo, entao serve de comparacao honesta
// mesmo quando nao aparece nos dados.
const BASELINE_MODEL = 'claude-opus-5';

// Eventos sinteticos do harness (ex.: "<synthetic>") nao sao modelo de verdade
// - sao marcadores internos. Identificados pelo formato "<...>" .
const SYNTHETIC_MODEL_RE = /^<.*>$/;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

// Faz JSON.parse de uma linha isolada. Retorna null (nunca lanca) em erro.
function parseLine(line) {
  const trimmed = line.trim();
  if (trimmed === '') return null;
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    return null;
  }
}

// So conta eventos assistant com message.usage presente.
function isCountableEvent(obj) {
  if (!obj || typeof obj !== 'object') return false;
  if (obj.type !== 'assistant') return false;
  if (!obj.message || typeof obj.message !== 'object') return false;
  if (!obj.message.usage || typeof obj.message.usage !== 'object') return false;
  return true;
}

// Extrai um registro de uso normalizado a partir de um evento ja validado por
// isCountableEvent. usage.iterations e ignorado de proposito (detalhe interno
// que duplicaria os numeros se somado).
function extractUsage(obj) {
  const usage = obj.message.usage;
  const model = obj.message.model || null;
  return {
    requestId: obj.requestId || null,
    model: model || NO_MODEL_LABEL,
    timestamp: obj.timestamp || null,
    isSidechain: obj.isSidechain === true,
    usage: {
      input: usage.input_tokens || 0,
      cacheWrite: usage.cache_creation_input_tokens || 0,
      cacheRead: usage.cache_read_input_tokens || 0,
      output: usage.output_tokens || 0,
    },
  };
}

// Processa um array de linhas de texto cru (de um ou mais arquivos), fazendo
// parse + filtro + deduplicacao por requestId. Retorna { records, discarded,
// syntheticSkipped }. Eventos sem requestId nao sao deduplicados entre si
// (cada um conta uma vez). Eventos com model sintetico ("<...>", marcador
// interno do harness, sem custo real) sao descartados a parte, contados em
// syntheticSkipped - nunca entram em records nem na lista de sem-preco.
function collectUsageRecords(lines) {
  const records = [];
  const seenRequestIds = new Set();
  let discarded = 0;
  let syntheticSkipped = 0;

  for (const line of lines) {
    const obj = parseLine(line);
    if (obj === null) {
      if (line.trim() !== '') discarded += 1;
      continue;
    }
    if (!isCountableEvent(obj)) continue;

    const rawModel = obj.message.model;
    if (typeof rawModel === 'string' && SYNTHETIC_MODEL_RE.test(rawModel)) {
      syntheticSkipped += 1;
      continue;
    }

    const record = extractUsage(obj);
    if (record.requestId) {
      if (seenRequestIds.has(record.requestId)) continue;
      seenRequestIds.add(record.requestId);
    }
    records.push(record);
  }

  return { records, discarded, syntheticSkipped };
}

// Filtra registros por timestamp >= since (string ISO). Registro sem timestamp
// sempre entra.
function filterSince(records, sinceIso) {
  if (!sinceIso) return records;
  const sinceMs = new Date(sinceIso).getTime();
  if (Number.isNaN(sinceMs)) return records;
  return records.filter((r) => {
    if (!r.timestamp) return true;
    const ms = new Date(r.timestamp).getTime();
    if (Number.isNaN(ms)) return true;
    return ms >= sinceMs;
  });
}

// ---------------------------------------------------------------------------
// Precificacao
// ---------------------------------------------------------------------------

// Remove um sufixo de data "-YYYYMMDD" do final do id do modelo, so para fins
// de consulta na tabela de precos (ex.: "claude-haiku-4-5-20251001" ->
// "claude-haiku-4-5"). Sem fuzzy match nem corte por prefixo - so esse padrao
// exato, para nunca precificar um modelo diferente em silencio.
function normalizeModelId(model) {
  if (typeof model !== 'string') return model;
  const match = model.match(/^(.+)-\d{8}$/);
  return match ? match[1] : model;
}

// Calcula o custo USD de um usage para um modelo. Retorna null se o modelo nao
// estiver na tabela de precos (ou for o rotulo "sem modelo").
function computeCost(model, usage) {
  const price = PRICES[normalizeModelId(model)];
  if (!price) return null;
  return (
    (usage.input / 1e6) * price.in +
    (usage.cacheWrite / 1e6) * price.cacheWrite +
    (usage.cacheRead / 1e6) * price.cacheRead +
    (usage.output / 1e6) * price.out
  );
}

// ---------------------------------------------------------------------------
// Agregacao
// ---------------------------------------------------------------------------

function emptyTotals() {
  return { messages: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, cost: 0, costKnown: true };
}

function addUsageToTotals(totals, usage) {
  totals.messages += 1;
  totals.input += usage.input;
  totals.cacheWrite += usage.cacheWrite;
  totals.cacheRead += usage.cacheRead;
  totals.output += usage.output;
}

// Agrega os registros (ja deduplicados/filtrados) por modelo e por lado
// (sessao principal vs subagentes). Retorna a estrutura crua do relatorio.
function aggregateByModel(records) {
  const byModel = new Map();
  const bySide = { main: emptyTotals(), sub: emptyTotals() };
  const unpricedModels = new Set();

  for (const record of records) {
    const { model, usage, isSidechain } = record;

    if (!byModel.has(model)) byModel.set(model, emptyTotals());
    const modelTotals = byModel.get(model);
    addUsageToTotals(modelTotals, usage);

    const cost = model === NO_MODEL_LABEL ? null : computeCost(model, usage);
    if (cost === null) {
      modelTotals.costKnown = false;
      if (model !== NO_MODEL_LABEL) unpricedModels.add(model);
    } else {
      modelTotals.cost += cost;
    }

    const side = isSidechain ? bySide.sub : bySide.main;
    addUsageToTotals(side, usage);
    if (cost !== null) side.cost += cost;
  }

  return { byModel, bySide, unpricedModels };
}

// Funcao pura: custo USD de reprecificar um total de tokens inteiro como se
// tivesse rodado todo em um unico modelo. Retorna null se modelId nao tiver
// preco conhecido. E a peca basica dos dois contrafactuais do relatorio -
// compara precificacao dos MESMOS tokens, nao simula qualidade equivalente
// (um mesmo prompt nao gasta o mesmo tanto de tokens em modelos diferentes).
function counterfactual(totals, modelId) {
  return computeCost(modelId, totals);
}

// Funcao pura: decompoe o custo de um total de tokens em CONTEXTO (input +
// cacheWrite + cacheRead) e GERACAO (output), para um modelo dado. Retorna
// { context, generation } com ambos null se o modelo nao tiver preco
// conhecido (mesmo criterio de counterfactual/computeCost - nunca chuta).
function splitCost(totals, modelId) {
  const price = PRICES[normalizeModelId(modelId)];
  if (!price) return { context: null, generation: null };
  const context =
    (totals.input / 1e6) * price.in +
    (totals.cacheWrite / 1e6) * price.cacheWrite +
    (totals.cacheRead / 1e6) * price.cacheRead;
  const generation = (totals.output / 1e6) * price.out;
  return { context, generation };
}

function buildSavings(cost, realCost) {
  if (cost === null) return null;
  const savings = cost - realCost;
  const savingsPct = cost > 0 ? (savings / cost) * 100 : 0;
  return { savings, savingsPct };
}

// Monta os dois contrafactuais do relatorio a partir da agregacao por modelo:
// - "top": teto teorico - reprecifica todos os tokens que apareceram pelo
//   modelo mais caro que de fato apareceu E tem preco (score = soma dos 4
//   precos unitarios da tabela, criterio simples e deterministico).
// - "baseline": comparacao honesta - reprecifica pelo BASELINE_MODEL
//   (claude-opus-5), o default plausivel de quem nao roteia por custo. Usa a
//   tabela de precos dele mesmo que ele nao apareca nos dados reais.
function buildCounterfactualReport(byModel) {
  let totalTokens = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
  let realCost = 0;

  for (const totals of byModel.values()) {
    totalTokens.input += totals.input;
    totalTokens.cacheWrite += totals.cacheWrite;
    totalTokens.cacheRead += totals.cacheRead;
    totalTokens.output += totals.output;
    realCost += totals.cost;
  }

  let mostExpensiveModel = null;
  let mostExpensiveScore = -1;
  for (const model of byModel.keys()) {
    const price = PRICES[normalizeModelId(model)];
    if (!price) continue;
    const score = price.in + price.out + price.cacheWrite + price.cacheRead;
    if (score > mostExpensiveScore) {
      mostExpensiveScore = score;
      mostExpensiveModel = model;
    }
  }

  let top = null;
  if (mostExpensiveModel) {
    const cost = counterfactual(totalTokens, mostExpensiveModel);
    top = Object.assign({ model: mostExpensiveModel, cost }, buildSavings(cost, realCost));
  }

  const baselineCost = counterfactual(totalTokens, BASELINE_MODEL);
  const baseline = Object.assign({ model: BASELINE_MODEL, cost: baselineCost }, buildSavings(baselineCost, realCost));

  return { totalTokens, realCost, top, baseline };
}

// ---------------------------------------------------------------------------
// I/O - varredura de arquivos
// ---------------------------------------------------------------------------

function findJsonlFiles(dir) {
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findJsonlFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      results.push(full);
    }
  }
  return results;
}

function readLinesFromFiles(files) {
  const lines = [];
  let filesRead = 0;
  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf8');
      lines.push(...content.split(/\r?\n/));
      filesRead += 1;
    } catch (err) {
      // arquivo ilegivel: ignora e segue (nao derruba a execucao)
    }
  }
  return { lines, filesRead };
}

// ---------------------------------------------------------------------------
// Relatorio
// ---------------------------------------------------------------------------

// Monta o relatorio completo a partir de linhas cruas (ja lidas de disco) mais
// metadados de varredura. Funcao pura (sem I/O).
function buildReport(lines, opts, meta) {
  opts = opts || {};
  meta = meta || {};

  const { records, discarded, syntheticSkipped } = collectUsageRecords(lines);
  const filtered = filterSince(records, opts.since);
  const { byModel, bySide, unpricedModels } = aggregateByModel(filtered);
  const counterfactualReport = buildCounterfactualReport(byModel);

  let totalCost = 0;
  let totalCostKnown = 0;
  for (const totals of byModel.values()) totalCost += totals.cost;

  const modelRows = [...byModel.entries()]
    .map(([model, totals]) => {
      const priced = totals.costKnown && model !== NO_MODEL_LABEL;
      const split = priced ? splitCost(totals, model) : { context: null, generation: null };
      return {
        model,
        messages: totals.messages,
        input: totals.input,
        cacheWrite: totals.cacheWrite,
        cacheRead: totals.cacheRead,
        output: totals.output,
        cost: priced ? totals.cost : null,
        pctOfTotal: totalCost > 0 && priced ? (totals.cost / totalCost) * 100 : null,
        contextCost: split.context,
        generationCost: split.generation,
      };
    })
    .sort((a, b) => (b.cost || 0) - (a.cost || 0));

  let totalContextCost = 0;
  let totalGenerationCost = 0;
  for (const row of modelRows) {
    if (row.contextCost !== null) totalContextCost += row.contextCost;
    if (row.generationCost !== null) totalGenerationCost += row.generationCost;
  }
  const pricedTotal = totalContextCost + totalGenerationCost;
  const costSplit = {
    context: totalContextCost,
    generation: totalGenerationCost,
    pctContext: pricedTotal > 0 ? (totalContextCost / pricedTotal) * 100 : null,
  };

  return {
    modelRows,
    bySide,
    counterfactual: counterfactualReport,
    totalCost,
    costSplit,
    footer: {
      filesRead: meta.filesRead || 0,
      eventsCounted: filtered.length,
      discardedLines: discarded,
      syntheticSkipped,
      unpricedModels: [...unpricedModels],
    },
  };
}

// ---------------------------------------------------------------------------
// Formatacao de saida
// ---------------------------------------------------------------------------

function fmtMoney(n) {
  if (n === null || n === undefined) return 'n/d';
  return n.toFixed(2);
}

function fmtInt(n) {
  return Math.round(n).toLocaleString('en-US');
}

function padRight(str, width) {
  str = String(str);
  return str.length >= width ? str : str + ' '.repeat(width - str.length);
}

function padLeft(str, width) {
  str = String(str);
  return str.length >= width ? str : ' '.repeat(width - str.length) + str;
}

function renderTable(report) {
  const lines = [];

  lines.push('=== Gasto por modelo ===');
  const header = [
    padRight('modelo', 26),
    padLeft('msgs', 8),
    padLeft('input', 12),
    padLeft('cache_w', 12),
    padLeft('cache_r', 12),
    padLeft('output', 12),
    padLeft('custo USD', 12),
    padLeft('% total', 9),
  ].join(' ');
  lines.push(header);
  for (const row of report.modelRows) {
    lines.push(
      [
        padRight(row.model, 26),
        padLeft(fmtInt(row.messages), 8),
        padLeft(fmtInt(row.input), 12),
        padLeft(fmtInt(row.cacheWrite), 12),
        padLeft(fmtInt(row.cacheRead), 12),
        padLeft(fmtInt(row.output), 12),
        padLeft(fmtMoney(row.cost), 12),
        padLeft(row.pctOfTotal === null ? 'n/d' : row.pctOfTotal.toFixed(1) + '%', 9),
      ].join(' ')
    );
  }
  lines.push('');

  lines.push('=== Contexto vs. geracao ===');
  const splitHeader = [
    padRight('modelo', 26),
    padLeft('contexto $', 12),
    padLeft('geracao $', 12),
    padLeft('% contexto', 12),
  ].join(' ');
  lines.push(splitHeader);
  for (const row of report.modelRows) {
    const pctContext =
      row.contextCost !== null && row.generationCost !== null && row.contextCost + row.generationCost > 0
        ? ((row.contextCost / (row.contextCost + row.generationCost)) * 100).toFixed(1) + '%'
        : 'n/d';
    lines.push(
      [
        padRight(row.model, 26),
        padLeft(fmtMoney(row.contextCost), 12),
        padLeft(fmtMoney(row.generationCost), 12),
        padLeft(pctContext, 12),
      ].join(' ')
    );
  }
  lines.push(
    [
      padRight('TOTAL', 26),
      padLeft(fmtMoney(report.costSplit.context), 12),
      padLeft(fmtMoney(report.costSplit.generation), 12),
      padLeft(report.costSplit.pctContext === null ? 'n/d' : report.costSplit.pctContext.toFixed(1) + '%', 12),
    ].join(' ')
  );
  lines.push('');

  lines.push('=== Onde o trabalho rodou ===');
  const side = report.bySide;
  lines.push(
    `Sessao principal: ${fmtInt(side.main.messages)} msgs, ${fmtInt(side.main.output)} tokens de saida, custo $${fmtMoney(side.main.cost)}`
  );
  lines.push(
    `Subagentes:       ${fmtInt(side.sub.messages)} msgs, ${fmtInt(side.sub.output)} tokens de saida, custo $${fmtMoney(side.sub.cost)}`
  );
  lines.push('');

  lines.push('=== Economia do roteamento ===');
  lines.push('(comparacao de precificacao dos MESMOS tokens - nao e simulacao de qualidade equivalente)');
  const cf = report.counterfactual;
  lines.push(`Custo real total: $${fmtMoney(cf.realCost)}`);
  if (!cf.top) {
    lines.push('vs. modelo topo: sem modelo precificado nos dados.');
  } else {
    lines.push(
      `vs. modelo topo (${cf.top.model}): $${fmtMoney(cf.top.cost)} | economia $${fmtMoney(cf.top.savings)} (${cf.top.savingsPct.toFixed(1)}%)`
    );
  }
  lines.push(
    `vs. baseline realista (${cf.baseline.model}): $${fmtMoney(cf.baseline.cost)} | economia $${fmtMoney(cf.baseline.savings)} (${cf.baseline.savingsPct.toFixed(1)}%)`
  );
  lines.push('');

  lines.push('=== Rodape ===');
  lines.push(`Arquivos lidos: ${report.footer.filesRead}`);
  lines.push(`Eventos contados: ${report.footer.eventsCounted}`);
  lines.push(`Linhas invalidas descartadas: ${report.footer.discardedLines}`);
  lines.push(`Eventos sinteticos do harness ignorados: ${report.footer.syntheticSkipped}`);
  lines.push(
    `Modelos sem preco: ${report.footer.unpricedModels.length ? report.footer.unpricedModels.join(', ') : '(nenhum)'}`
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { dir: null, since: null, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dir') {
      opts.dir = argv[i + 1];
      i += 1;
    } else if (arg === '--since') {
      opts.since = argv[i + 1];
      i += 1;
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    }
  }
  return opts;
}

function printHelp() {
  console.log(`Uso: node tools/route-report.js [--dir <caminho>] [--since YYYY-MM-DD] [--json]

  --dir     Diretorio a varrer recursivamente por *.jsonl (default: ~/.claude/projects)
  --since   Filtra eventos com timestamp >= a data informada
  --json    Imprime o relatorio em JSON em vez da tabela de texto
  --help    Mostra esta mensagem

O contrafactual compara a precificacao dos MESMOS tokens em outro modelo -
nao e uma simulacao de qualidade equivalente (um mesmo prompt nao gasta o
mesmo tanto de tokens em modelos diferentes).`);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  const dir = opts.dir || path.join(os.homedir(), '.claude', 'projects');
  const files = findJsonlFiles(dir);
  const { lines, filesRead } = readLinesFromFiles(files);
  const report = buildReport(lines, { since: opts.since }, { filesRead });

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderTable(report));
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  PRICES,
  NO_MODEL_LABEL,
  BASELINE_MODEL,
  parseLine,
  isCountableEvent,
  extractUsage,
  normalizeModelId,
  collectUsageRecords,
  filterSince,
  computeCost,
  aggregateByModel,
  counterfactual,
  splitCost,
  buildCounterfactualReport,
  buildReport,
  renderTable,
  findJsonlFiles,
  readLinesFromFiles,
  parseArgs,
};
