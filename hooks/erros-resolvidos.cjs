#!/usr/bin/env node
// Hook SessionStart/PostCompact — injeta os erros já resolvidos neste projeto.
//
// Existe por causa de um padrão recorrente de retrabalho: o mesmo bug fechado
// mais de uma vez, em dias diferentes, porque a solução morre junto com o
// contexto da sessão em que foi encontrada. Semanas depois o mesmo erro chega
// como novidade.
//
// Uma memória de conversas genérica não cobre isso: ela guarda o que foi
// dito, não a causa e a correção de um bug, indexadas pelo erro. O que falta
// é um arquivo pequeno por projeto, lido em toda sessão, escrito no momento
// em que a causa foi confirmada.
//
// A escrita é responsabilidade do agente (regra nas instruções do projeto),
// não de quem opera a sessão. Foi deliberado: qualquer desenho que dependa de
// alguém lembrar de rodar um comando manual falha exatamente no dia cansativo
// em que o registro mais importava — e ferramenta que exige lembrar é a que
// não é usada.
const { existsSync, readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

const NOME = 'ERROS-RESOLVIDOS.md';
const LIMITE = 8000; // corta antes de o arquivo virar um custo fixo de sessão

let entrada = '';
process.stdin.on('data', (d) => (entrada += d));
process.stdin.on('end', () => {
  let cwd = process.cwd();
  try {
    const d = JSON.parse(entrada);
    if (d.cwd) cwd = d.cwd;
    else if (d.workspace?.current_dir) cwd = d.workspace.current_dir;
  } catch (_) { /* sem payload, vale o cwd */ }

  // A raiz do repositório, não o cwd: abrir a sessão numa subpasta de um
  // monorepo não pode esconder o arquivo que está na raiz — se escondesse,
  // nasceria um ERROS-RESOLVIDOS.md por subpasta e nenhum deles seria lido
  // inteiro. Fora de repo git, vale o cwd mesmo.
  let raiz = null;
  try {
    raiz = execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 700,
    }).trim() || null;
  } catch (_) { /* não é repo git */ }

  const candidatos = raiz ? [join(raiz, NOME), join(cwd, NOME)] : [join(cwd, NOME)];
  const arq = candidatos.find(existsSync) || candidatos[0];
  const existe = existsSync(arq);

  // Sem repo git e sem arquivo: quase sempre é uma pasta qualquer, não um
  // projeto. Mandar criar um registro de bugs ali é ruído em toda sessão.
  if (!existe && !raiz) return process.exit(0);

  // O arquivo não existe ainda: em vez de ficar calado, a sessão já carrega a
  // regra de criá-lo. Sem isto o hook só serviria a projetos que já têm o
  // arquivo, e nenhum projeto novo jamais teria — o problema se perpetuaria.
  if (!existe) {
    process.stdout.write(
      `[ERROS RESOLVIDOS] ${raiz || cwd} ainda não tem ${NOME} (crie na raiz do projeto).\n`
      + `Ao confirmar a causa de um bug NÃO-ÓBVIO aqui (algo que custou mais de `
      + `uma tentativa, ou que um "já resolvi isso antes" explicaria), crie o `
      + `arquivo e registre. Formato de cada entrada:\n\n`
      + `## <sintoma exato, do jeito que ele aparece — mensagem ou comportamento>\n`
      + `- **Causa:** <a causa real, confirmada, não a suspeita>\n`
      + `- **Correção:** <comando ou arquivo:linha>\n`
      + `- **Como reconhecer de novo:** <o sinal que identifica este caso>\n`
      + `- <data>\n\n`
      + `Indexe pelo SINTOMA, não pela solução: daqui a um mês o que se tem em `
      + `mãos é o erro, não a resposta. Não registre bug trivial — arquivo `
      + `inchado deixa de ser lido, e aí não serve para nada.\n`,
    );
    return process.exit(0);
  }

  let txt = '';
  try { txt = readFileSync(arq, 'utf8'); } catch (_) { return process.exit(0); }
  if (!txt.trim()) return process.exit(0);

  let corpo = txt;
  let aviso = '';
  if (corpo.length > LIMITE) {
    // Trunca no início de uma entrada, nunca no meio de uma: meia entrada é
    // pior que entrada nenhuma, porque parece completa e engana.
    const corte = corpo.lastIndexOf('\n## ', LIMITE);
    corpo = corpo.slice(0, corte > 0 ? corte : LIMITE);
    aviso = `\n\n[truncado: ${NOME} passou de ${LIMITE} caracteres. `
      + `Vale podar as entradas que não se repetem mais.]`;
  }

  process.stdout.write(
    `[ERROS JÁ RESOLVIDOS NESTE PROJETO]\n`
    + `Estes bugs já foram diagnosticados aqui antes. ANTES de investigar um `
    + `erro, confira se ele está nesta lista — se estiver, aplique a correção `
    + `registrada em vez de diagnosticar do zero. Ao fechar um bug não-óbvio `
    + `novo, acrescente uma entrada no mesmo formato.\n\n`
    + corpo + aviso + '\n',
  );
});
