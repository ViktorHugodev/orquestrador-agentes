# Orquestrador de agentes

Configuração pessoal de um orquestrador multiagente sobre o Claude Code, em
uso diário por um desenvolvedor: roteamento de tarefas por custo e
capacidade, subagentes com contrato de handoff explícito, e hooks que tornam
barulhenta a omissão dessas regras em vez de depender de alguém lembrar delas.

Para não haver dúvida sobre o que roda e o que é só configuração: **não existe
código de orquestração aqui.** Quem classifica a tarefa, escreve o contrato e
valida o retorno é o modelo da sessão, seguindo as instruções em `agents/`,
`commands/` e `docs/`. O código de verdade são três hooks Node.js sem
dependências (`hooks/`), que injetam lembretes nos eventos do harness, e uma
CLI de medição (`tools/`). Não é framework nem produto — é a configuração real
de um sistema de uma pessoa, extraída, generalizada e documentada. O valor
está nas cinco decisões de arquitetura abaixo, cada uma com o que ela custa,
e nos limites declarados no fim.

```
   tarefa
     │
     ▼
 ┌───────────────────────────────┐
 │  triagem de rota              │  lembrete injetado por hook em todo prompt;
 └───────────────┬───────────────┘  quem classifica é o modelo da sessão
                 │  custo × capacidade
   ┌─────────────┼─────────────┬──────────────┐
   ▼             ▼             ▼              ▼
 Haiku        Sonnet      CLI externo       Opus
exploração  implementação   revisão      arquitetura
   └─────────────┴─────────────┴──────────────┘
                 │
                 ▼
 ┌───────────────────────────────┐
 │  contrato de handoff          │  objetivo · arquivos ·
 │  4 campos, nenhum opcional    │  aceite · limites
 └───────────────┬───────────────┘
                 ▼
     worktree isolada, se a task escreve
     sobre trabalho ainda não commitado
                 ▼
 ┌───────────────────────────────┐
 │  critério de aceite           │  comando executável rodado pelo
 │                               │  orquestrador — nunca o relatório
 └───────────────────────────────┘  que o subagente escreveu sobre si
```

## Estrutura

```
agents/
  explorador.md         subagente Haiku para busca, leitura e coleta de contexto
  executor.md           subagente Sonnet de implementação com escopo fechado
commands/
  rota.md               comando que classifica uma task e já dispara o executor certo
skills/
  superplan.md          plano revisado por um modelo de outro fornecedor, via CLI
  verifica.md           veredito por afirmação, com fonte, feito por quem não afirmou
hooks/
  route-triage.cjs      lembra a triagem de rota em todo prompt
  erros-resolvidos.cjs  injeta bugs já resolvidos no início da sessão
  status-lembrete.cjs   avisa quando o turno fecha com estado não salvo
  hooks.json            wiring de exemplo para os três hooks acima
tools/
  route-report.js       mede gasto por modelo a partir dos transcripts locais
docs/
  routing.md            a tabela de roteamento e o porquê de cada degrau
  memoria-de-erros.md   formato do arquivo de erros que o hook injeta na sessão
  handoff.md            o contrato de delegação e o critério de aceite executável
```

## 1. Roteamento multi-modelo por custo e capacidade

A escolha óbvia é rodar toda tarefa no modelo mais forte disponível. É também
a que desperdiça a maior parte da cota: uma busca de arquivo não precisa do
mesmo motor que uma decisão de arquitetura. A correção é uma tabela explícita
de rotas, com um motor nomeado em cada linha — Haiku para trabalho mecânico,
Sonnet como default de implementação, um CLI externo de outro fornecedor como
revisor (revisão exige viés diferente de quem produziu o resultado), um
segundo CLI externo para volume, e Opus reservado para arquitetura, trade-off
e debug sem hipótese. Cada degrau só entra quando o anterior comprovadamente
não resolve. A tabela e o porquê de cada linha estão em
[`docs/routing.md`](docs/routing.md).

O custo: a triagem é imposto fixo em todo prompt, e a tabela vive em dois
lugares — no doc e no texto do hook — sincronizados à mão, sem teste que
detecte divergência. Rota errada para baixo custa uma ida e volta; para cima
custa cota que ninguém percebe, porque o resultado sai bom mesmo assim. O
sistema aceita o primeiro erro para evitar o segundo. Quanto isso de fato economiza, e onde a
política não está sendo seguida, está medido em [Medição](#medição).

## 2. Handoff como contrato escrito, não repasse de contexto

Delegar parece mais completo quando se joga o contexto inteiro para o
subagente. É o oposto do que a delegação deveria comprar: montar esse contexto
à mão, no modelo caro, gasta a cota que a delegação existia para proteger. O
contrato aqui tem quatro campos fixos — objetivo em uma frase, arquivos que
podem e não podem ser tocados, critério de aceite, limites — e faltar um deles
é sinal de que a tarefa não está fechada o bastante para sair da mão do
orquestrador. Ver [`docs/handoff.md`](docs/handoff.md).

O custo: escrever o contrato tem preço fixo, então tarefa de uma linha não
compensa delegar, e tarefa que depende de algo vivo na conversa não cabe num
contrato escrito — as duas ficam com o orquestrador, por desenho. A lista do
que não delegar está em [`commands/rota.md`](commands/rota.md).

## 3. Critério de aceite sempre executável, nunca um adjetivo

"Deixar o código mais limpo" não é critério de aceite; "rodar o typecheck sem
erro" é. Um adjetivo exige julgamento sobre se a tarefa terminou; um comando
produz resultado binário reproduzível. Esse é o problema mais difícil de um
sistema agêntico — saber que o agente terminou de verdade, e não que parou e
escreveu um relatório dizendo que terminou. Validar entrega é rodar o comando
de aceite, nunca ler o resumo que o subagente escreveu sobre si mesmo.

O custo: isso exclui da delegação toda tarefa sem comando possível —
arquitetura, prosa, decisão de interface — e um comando que passa só prova o
que o comando cobre. Typecheck verde não diz nada sobre o teste que não foi
escrito.

## 4. O executor lê o repositório sozinho

O executor em [`agents/executor.md`](agents/executor.md) recebe o contrato e
tem acesso direto a leitura, edição, busca e execução no repositório. Ele
investiga o que precisar por conta própria, deslocando o custo de exploração
para o nível de modelo certo. O subagente
[`agents/explorador.md`](agents/explorador.md) cobre o caso simétrico: só
busca e leitura, em Haiku, retornando sempre um resumo — nunca o conteúdo bruto,
o que anularia a economia de rodar no modelo barato.

O custo: exploração paga duas vezes, a preços diferentes, quando o orquestrador
já tinha lido o que o executor vai reler. E sem memória compartilhada o
executor pode seguir na direção errada até o diff voltar — a mitigação é o
campo ARQUIVOS do contrato e a regra de parar e devolver quando aparece decisão
de arquitetura não prevista, em vez de decidir sozinho.

## 5. Isolamento de execução por worktree

Tarefa delegada que escreve direto no checkout principal mistura o trabalho do
subagente com o que já estava em progresso, e uma falha de agente vira estrago
real. Task que escreve em repositório com mudanças não commitadas roda em
worktree git separada: pior caso vira uma pasta descartável.

O custo: a worktree nasce sem dependências instaladas, sem cache de build e sem
arquivo não versionado (`.env`), e o merge de volta é manual. Por isso é
condicional — árvore limpa não paga esse preço.

## 6. Quem produz não verifica

O princípio aparece três vezes neste repositório: o critério de aceite é um
comando e não o relatório do subagente sobre si mesmo; o plano é criticado por
quem não o escreveu; e o fato é checado por quem não o afirmou. As duas últimas
usam o mesmo instrumento — um modelo de outro fornecedor, por CLI própria, em
modo somente-leitura.

O motivo de ser outro fornecedor, e não outra sessão do mesmo modelo: pedir
crítica a quem escreveu o plano produz concordância educada, porque ele já
aceitou as próprias premissas. Um revisor que não herdou o raciocínio ataca a
premissa, não a redação.

[`skills/superplan.md`](skills/superplan.md) cobre a decisão de arquitetura.
Quem planeja marca no texto onde quer contraditório; o revisor responde ponto a
ponto — concordo, discordo com cenário concreto de falha, faltou; e o plano
final carrega a lista do que foi aceito, do que foi rejeitado e por quê. Essa
lista é o que impede a revisão de virar teatro: sem ela não há como saber depois
se a crítica mudou alguma coisa.

O custo: é a parte mais cara e mais frágil do conjunto. Cada fornecedor tem CLI,
sandbox e formato de saída próprios, e o plano precisa ser recortado — texto,
nunca o código — para caber no prompt do revisor. As cinco armadilhas listadas
no fim da skill custaram uma rodada cada em execução real, de decodificação de
UTF-8 pelo shell a instrução persistente herdada da CLI do revisor. Também é
lento: minutos, não segundos. Por isso não roda em tarefa de rotina, só onde
errar sai mais caro do que esperar.

Uma segunda aplicação do mesmo princípio: [`skills/verifica.md`](skills/verifica.md)
manda as afirmações checáveis de um texto — número, data, versão, citação,
alegação técnica — para o revisor externo devolver um veredito e uma fonte por
afirmação, com instrução explícita de procurar evidência que **refute** antes de
aceitar. A taxonomia separa "não verificável" de "falso", que é a distinção que
a maioria das verificações automáticas erra: ausência de fonte tratada como
refutação produz uma correção errada, pior que a dúvida original.

Nos dois casos o veredito do revisor não obriga automaticamente. Havendo fonte
melhor, a afirmação fica — com a fonte à vista. Aceitar tudo que o verificador
diz não elimina a autoridade, só a transfere.

## 7. Memória de projeto indexada pelo sintoma

Um agente que não lembra rediagnostica. O mesmo bug foi corrigido três vezes em
dias diferentes, cada vez do zero. O hook `erros-resolvidos.cjs` injeta no
início da sessão o `ERROS-RESOLVIDOS.md` do projeto, e o formato está em
[`docs/memoria-de-erros.md`](docs/memoria-de-erros.md): sintoma como título,
causa confirmada, correção com arquivo e linha, e o sinal que identifica o caso
de novo.

A escolha que importa é o índice. Memória conversacional guarda **o que foi
dito**, e é inútil quando o que se tem em mãos é uma mensagem de erro: a
pergunta ali é "isto já aconteceu?", e ela só é respondível se a chave for o
sintoma. Por isso o título da entrada é a mensagem de erro como ela aparece na
tela, não o nome da solução.

O custo: é curadoria manual e o arquivo inteiro entra em toda sessão. Registrar
bug trivial infla o arquivo até ele deixar de ser lido — e memória que ninguém
lê é só um imposto de contexto. A regra de admissão (custou mais de uma
tentativa) existe para isso, e é aplicada por julgamento, sem teste que a
garanta.

## Os hooks

Os três hooks em `hooks/` tornam barulhenta, no nível do harness, a omissão de
disciplinas que a tabela de roteamento e o contrato já definem. Eles não
impõem nada: o modelo ainda pode ignorar o lembrete. O que muda é que a regra
esquecida volta a aparecer no prompt seguinte, em vez de apodrecer em silêncio.

Cada um entra num ponto diferente do ciclo de vida da sessão:

```
 evento do harness            hook                   o que injeta

 SessionStart ──────────▶ erros-resolvidos.cjs ──▶ os bugs já diagnosticados
      │                                             neste projeto, por sintoma
      ▼
 UserPromptSubmit ──────▶ route-triage.cjs ─────▶ o lembrete de classificar a
      │                                             rota antes de agir
      ▼
 ┌─────────────────────────────────────────────────────────────────────┐
 │  o turno: classificar · delegar com contrato · validar pelo aceite  │
 └─────────────────────────────────────────────────────────────────────┘
      │
      ▼
 Stop ──────────────────▶ status-lembrete.cjs ──▶ o aviso de estado não salvo,
                                                    se a árvore está suja
```

O acoplamento com o harness é real e está declarado nos limites: o stdout de
`UserPromptSubmit` vira contexto, e o `Stop` só alcança o modelo devolvendo
`decision: block`. Mudança nesses contratos quebra os três.

- **`route-triage.cjs`** injeta o lembrete de classificar a rota em todo
  prompt não trivial. O texto do lembrete é fixo no hook, não lido da tabela —
  é a duplicação manual admitida na decisão 1. O que ele lê do projeto é só um
  marcador de suspensão nas instruções, para repositórios que decidiram não
  usar a triagem.
- **`erros-resolvidos.cjs`** injeta, no início de cada sessão, os bugs
  não-óbvios já diagnosticados naquele projeto — indexados pelo sintoma, não
  pela solução, porque semanas depois o que se tem em mãos é o erro
  acontecendo de novo, não a resposta.
- **`status-lembrete.cjs`** avisa, ao fim de um turno com mudanças não
  commitadas, quando o estado do trabalho não foi salvo em lugar legível na
  retomada. O hook nunca escreve esse estado sozinho: ele não sabe o que foi
  feito no turno, e um resumo inventado seria lido depois com ar de certeza.

`hooks/hooks.json` mostra o wiring — os caminhos precisam ser ajustados para
onde o projeto de fato mora.

## Medição

[`tools/route-report.js`](tools/route-report.js) é uma CLI Node sem
dependências que varre os transcripts JSONL locais do Claude Code e produz o
gasto por modelo, a divisão entre sessão principal e subagentes, e a
comparação com ter rodado os mesmos tokens em um único modelo. Existe porque
"rotear economiza" era hipótese, e hipótese sobre custo tem o hábito de
sobreviver por não ser medida.

Resultado da primeira execução, sobre **33.921 chamadas em 609 sessões**:

| modelo | % do custo |
|---|---|
| Opus 5 | 74,7% |
| Fable 5.1 | 13,8% |
| Sonnet 5 | 8,9% |
| demais (Opus 4.8, Fable 5, Haiku 4.5, Sonnet 4.6) | 2,5% |

Subagentes respondem por **7% do custo total** — a delegação existe, mas
move pouco dinheiro.

Duas comparações, porque uma só engana. Contra o modelo mais caro presente nos
dados, a economia é de **55,6%**; contra um baseline realista de rodar tudo em
Opus 5, é de **11,2%**. A primeira é um teto teórico sem valor prático:
ninguém rodaria uma busca de arquivo no modelo topo. A segunda é a que
descreve a decisão real. Ambas comparam a precificação dos **mesmos tokens** —
nenhuma das duas simula o retrabalho de um modelo mais barato errar a tarefa,
e essa é a variável que decidiria a questão de verdade.

O primeiro achado é desconfortável: **74,7% do gasto está no modelo caro**, num
repositório cuja tabela define o intermediário como default de implementação. A
medição contradiz a política que ela deveria confirmar.

O segundo achado explica o primeiro, e é o que muda o desenho. Separando o custo
entre **contexto** (input, cache write, cache read) e **geração** (output):

```
 custo total, por natureza do token

 ├──────────────────── contexto · 81,8% ────────────────────┤├─ geração 18,2% ─┤
 │  input + cache write + cache read                        ││  output         │
 └──────────────────────────────────────────────────────────┘└─────────────────┘
                            ▲                                         ▲
                            │                                         │
              sessão mais curta, menos releitura            roteamento por custo
                    (não implementado)                         (implementado)
```

O roteamento move **geração** para um modelo barato, e geração é 18% da conta. O
que domina é manter a conversa aberta: no modelo topo a média é de **148 mil
tokens de cache read por mensagem**, o que faz cada turno custar cerca de
US$ 0,07 antes de gerar um único token. Vinte e um mil turnos depois, essa
releitura sozinha é quase metade da conta inteira.

Pior para a tese original: delegar **acrescenta** turnos ao orquestrador caro —
montar o contrato, ler o diff, rodar o aceite. Em tarefa pequena o overhead de
orquestração custa mais do que a economia de geração, e a política não tem como
perceber isso, porque classifica por tipo de tarefa e não por tamanho.

Onde a delegação foi usada, ela funcionou: os subagentes fizeram 6.828 mensagens
por US$ 235, contra cerca de US$ 586 que o mesmo perfil de tokens custaria no
modelo topo. É economia real — e é 10% da conta, porque só um quinto das
mensagens foi delegado.

A conclusão que sai daqui não é "rotear melhor". É que a próxima alavanca está em
**encurtar sessão e enxugar contexto**, que corta custo em todos os turnos sem
mexer em nenhuma regra de rota. A premissa do projeto estava certa na direção e
errada na magnitude — e isso só apareceu depois de existir instrumento.

O que o relatório não mede: o gasto nos CLIs externos de revisão e volume, que
rodam fora dos transcripts do Claude Code e só aparecem na fatura de cada
fornecedor. Modelo sem preço na tabela tem os tokens contados e o custo
reportado como indisponível — a CLI nunca estima um preço que não conhece.

## O que isto não é, e limites conhecidos

- **Não é um runtime de agentes.** Não há loop, scheduler nem estado
  persistente aqui. A orquestração é o modelo da sessão seguindo instruções
  em markdown — funciona na medida em que o modelo obedece, e os hooks só
  tornam a desobediência visível.
- **Acoplado ao Claude Code.** O formato de subagente, comando e hook é o do
  Claude Code, e os hooks dependem de contratos específicos do harness — o
  stdout de `UserPromptSubmit` vira contexto, o `Stop` só fala com o modelo
  via `decision: block`. Mudança nesses contratos quebra os três.
- **Amostra de um.** É a configuração de uma pessoa, para o trabalho dessa
  pessoa. Não há evidência de que as regras sirvam a um time, e algumas — "na
  dúvida, o mais barato" — assumem um único operador que absorve o retrabalho.
- **A qualidade não foi medida, só o preço.** O relatório compara a
  precificação dos mesmos tokens em modelos diferentes. Ele não mostra o que
  aconteceria se o modelo barato errasse a tarefa e ela voltasse — e é esse
  retrabalho, não a tabela de preços, que decide se rotear compensa.
- **Humano no laço, por desenho.** O orquestrador decide rota e valida o
  aceite, mas commit, push e qualquer ação irreversível ficam com quem opera.
  Não é um sistema autônomo e não pretende ser.

## Uso

Não é um pacote instalável — é referência para adaptar ao seu próprio harness.
Os `.md` de agentes e comandos seguem o formato de subagentes e comandos do
Claude Code; os hooks são scripts Node.js chamados pelos eventos
`UserPromptSubmit`, `SessionStart` e `Stop` via `hooks.json`. Adapte os
caminhos e os critérios da tabela de roteamento ao seu conjunto de modelos.

## Licença

MIT — ver [`LICENSE`](LICENSE).
