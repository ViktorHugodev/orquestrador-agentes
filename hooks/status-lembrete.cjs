#!/usr/bin/env node
// Hook Stop — ao fim de um turno que mexeu no repositório, lembra de fixar o
// estado em STATUS.md.
//
// Motivo: as instruções do projeto já mandam manter STATUS.md, mas isso só
// dispara quando alguém pede explicitamente para salvar o status — ou seja,
// no momento em que já se decidiu parar, que é justamente quando ninguém
// lembra de fazer isso. Quem perde o fio no meio de uma tarefa longa não vai
// lembrar de salvar o fio.
//
// O hook NÃO escreve o STATUS.md. Um hook não sabe o que foi feito no turno,
// só que arquivos mudaram; inventar conteúdo aqui produziria um STATUS.md
// mentiroso, que é pior que nenhum — ele seria lido na retomada e daria o
// passo errado com ar de certeza. Quem escreve é o agente, que tem o turno
// inteiro em contexto. O hook só dispara o gatilho na hora certa.
//
// Silencioso quando não há mudança: lembrete que aparece sempre vira ruído, e
// ruído constante é a forma mais rápida de treinar alguém a ignorar o aviso.
const { execFileSync } = require('node:child_process');
const { existsSync, statSync } = require('node:fs');
const { join } = require('node:path');

const MIN_ARQUIVOS = 2; // 1 arquivo mexido é ajuste solto, não estado a salvar
const JANELA_MIN = 20;   // STATUS.md tocado neste intervalo conta como já salvo

let entrada = '';
process.stdin.on('data', (d) => (entrada += d));
process.stdin.on('end', () => {
  let cwd = process.cwd();
  try {
    const d = JSON.parse(entrada);
    if (d.cwd) cwd = d.cwd;
    // stop_hook_active evita o laço: sem isto, o lembrete emitido no Stop pode
    // provocar outro turno, que dispara outro Stop, indefinidamente.
    if (d.stop_hook_active) return process.exit(0);
  } catch (_) { /* segue com o cwd */ }

  let sujos = '';
  try {
    // --untracked-files=no: pasta de build ou scratch não commitada deixaria o
    // contador acima do mínimo para sempre, e o aviso viraria ruído de todo turno.
    sujos = execFileSync('git', ['-C', cwd, 'status', '--porcelain', '--untracked-files=no'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 700,
    }).trim();
  } catch (_) {
    return process.exit(0); // fora de repo git não há estado a acompanhar
  }

  const linhas = sujos ? sujos.split('\n') : [];
  if (linhas.length < MIN_ARQUIVOS) return process.exit(0);

  // STATUS.md escrito há pouco = já foi salvo neste ciclo, cale. O critério é
  // mtime e não o porcelain do git: STATUS.md recém-criado costuma ser
  // untracked, e o `--untracked-files=no` acima o esconderia — as duas
  // verificações se anulariam e o aviso voltaria em todo turno, mesmo com o
  // arquivo na tela. Sem esta checagem o hook ainda afirmaria "não foi
  // atualizado" sem nunca ter olhado.
  const caminhoStatus = join(cwd, 'STATUS.md');
  const temStatus = existsSync(caminhoStatus);
  if (temStatus) {
    try {
      const idadeMin = (Date.now() - statSync(caminhoStatus).mtimeMs) / 60000;
      if (idadeMin < JANELA_MIN) return process.exit(0);
    } catch (_) { /* sem stat, segue e avisa: falhar barulhento é o lado certo */ }
  }
  const aviso =
    `[ESTADO NÃO SALVO] ${linhas.length} arquivos modificados neste repositório e `
    + `STATUS.md ${temStatus ? 'não foi tocado neste ciclo' : 'não existe'}.\n`
    + `Se o trabalho deste turno continua depois, ${temStatus ? 'atualize' : 'crie'} `
    + `STATUS.md agora, sem perguntar, com: situação em uma frase · PRÓXIMO PASSO `
    + `exato (um comando ou um arquivo:linha, nunca um adjetivo) · arquivos que `
    + `carregam o contexto · decisões tomadas no turno.\n`
    + `Se o trabalho fechou por completo, encerre sem escrever nada e sem comentar este aviso.`;

  // No evento Stop, stdout puro com exit 0 vai para o debug log e NUNCA chega ao
  // modelo — só UserPromptSubmit/SessionStart/PostCompact injetam stdout como
  // contexto. Para falar com o modelo aqui é preciso `decision: block`, que
  // devolve o turno com `reason` em contexto. O guard de stop_hook_active acima
  // é o que impede isto de virar laço.
  process.stdout.write(JSON.stringify({ decision: 'block', reason: aviso }));
});
