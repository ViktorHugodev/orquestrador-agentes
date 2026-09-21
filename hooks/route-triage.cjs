#!/usr/bin/env node
// Hook UserPromptSubmit — injeta lembrete de triagem de rota em todo prompt.
// stdout de UserPromptSubmit é adicionado como contexto para o modelo.
//
// O lembrete é DOIS pedaços, não um: a triagem de rota e a postura de
// execução. Eles se separaram porque não valem sempre juntos — um repositório
// pode suspender a delegação e continuar querendo "execute o próximo passo em
// vez de perguntar". Enquanto era um bloco só, suspender metade era
// impossível, e o hook contradizia as instruções do projeto a cada prompt.
//
// Quem decide a suspensão é o repositório, não esta lista — por isso a leitura
// é do arquivo de instruções do projeto (ex: CLAUDE.md), subindo a partir do
// cwd. A alternativa era um array de caminhos aqui dentro, e ele apodrece
// calado no dia em que um repo muda de pasta. O custo desta escolha é o
// oposto e está assumido: se alguém reescrever o título da seção, a triagem
// volta a aparecer. Falha para o lado barulhento, que é o lado certo — regra
// que volta a ser lembrada se corrige num prompt; regra silenciosamente
// desligada não se corrige nunca.
const { existsSync, readFileSync } = require('node:fs');
const { dirname, join } = require('node:path');

// O texto tem que repetir os MESMOS critérios da tabela de política de
// roteamento do projeto. Ele chega em todo prompt, depois das instruções do
// projeto, então quando os dois divergem é este que vence — e as instruções
// viram decoração. Mantenha os dois sincronizados manualmente.
const TRIAGEM = '[SISTEMA] Triagem obrigatória: anuncie `[ROTA → barato|intermediário|volume|revisor|topo | motivo]` '
  + 'antes de agir. O nível "topo": arquitetura, plano multi-etapa, trade-off, debug sem hipótese, review de '
  + 'diff alheio. Implementação vai para o nível intermediário (Agent tool com modelo explícito); exploração e '
  + 'leitura em massa vão para o nível barato; volume/tarefa longa vai para o agente de CLI dedicado; o revisor '
  + 'é para review e segunda opinião, não implementação. O resto DELEGA — o comando de rota já monta o contrato '
  + 'e dispara.';

const POSTURA = 'Ao terminar, EXECUTE o próximo passo óbvio em vez de perguntar — pergunta só se '
  + 'houver bifurcação real ou passo irreversível.';

// O arquivo de instruções do projeto marca a suspensão com um título de
// seção. Casa "Delegação suspensa" com ou sem acento e em qualquer caixa.
const SUSPENSO = /delega[çc][ãa]o\s+suspensa/i;
const ARQUIVO_INSTRUCOES = 'CLAUDE.md'; // troque pelo nome usado no seu projeto, se diferente

function delegacaoSuspensaEm(cwd) {
  let dir = cwd;
  for (let i = 0; i < 8 && dir; i++) {
    const arq = join(dir, ARQUIVO_INSTRUCOES);
    try {
      if (existsSync(arq) && SUSPENSO.test(readFileSync(arq, 'utf8'))) return true;
    } catch (_) { /* arquivo ilegível não é motivo para derrubar o prompt */ }
    const pai = dirname(dir);
    if (pai === dir) break;
    dir = pai;
  }
  return false;
}

let entrada = '';
process.stdin.on('data', (d) => (entrada += d));
process.stdin.on('end', () => {
  let prompt = '';
  let cwd = process.cwd();
  try {
    const dados = JSON.parse(entrada);
    prompt = (dados.prompt || '').toLowerCase();
    if (dados.cwd) cwd = dados.cwd;
  } catch (_) {}
  // Não polui prompts triviais (saudação, confirmação curta)
  if (prompt.trim().length < 15) return process.exit(0);

  const partes = delegacaoSuspensaEm(cwd) ? [POSTURA] : [TRIAGEM, POSTURA];
  process.stdout.write(partes.join(' '));
  process.exit(0);
});
