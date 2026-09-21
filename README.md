# Orquestrador de agentes

Configuração de um orquestrador multiagente sobre um CLI de coding agent
(Claude Code ou equivalente): roteamento de tarefas por custo e capacidade,
subagentes com contrato de handoff explícito, e hooks que reforçam a
disciplina de execução sem depender de alguém lembrar de segui-la.

Isto não é um framework nem um produto — é a configuração real de um sistema
que roda diariamente, extraída, generalizada e documentada. O valor está nas
decisões de arquitetura abaixo, não nas features.

## Estrutura

```
agents/
  explorador.md    subagente barato para busca, leitura e coleta de contexto
  executor.md      subagente de implementação com escopo fechado
commands/
  rota.md          comando que classifica uma task e já dispara o executor certo
hooks/
  route-triage.cjs      lembra a triagem de rota em todo prompt
  erros-resolvidos.cjs  injeta bugs já resolvidos no início da sessão
  status-lembrete.cjs   avisa quando o turno fecha com estado não salvo
  hooks.json             wiring de exemplo para os três hooks acima
docs/
  routing.md       a tabela de roteamento e o porquê de cada degrau
  handoff.md        o contrato de delegação e o critério de aceite executável
```

## 1. Roteamento multi-modelo por custo e capacidade

A escolha óbvia é rodar toda tarefa no modelo mais forte disponível. É também
a que desperdiça a maior parte da cota: uma busca de arquivo ou um resumo de
documentação não precisam do mesmo motor que uma decisão de arquitetura.
Tratar as duas coisas igual não é rigor, é ausência de critério.

A correção é uma tabela explícita de degraus — barato para trabalho mecânico,
intermediário como default de implementação, um nível de revisão separado da
implementação, e o nível mais caro reservado para arquitetura, trade-off e
debug sem hipótese nenhuma. Cada degrau só é usado quando o anterior
comprovadamente não resolve. Subir de nível por hábito, em vez de por
necessidade demonstrada, é o mesmo erro de rota que implementar direto no
nível mais caro — só mais difícil de perceber, porque o resultado tende a
sair bom mesmo quando o nível estava errado. Detalhe completo e a tabela em
[`docs/routing.md`](docs/routing.md).

## 2. Handoff como contrato escrito, não repasse de contexto

Delegar parece mais completo quando se joga o contexto inteiro para o
subagente: colar o arquivo, resumir o histórico, explicar o que já foi
tentado. É exatamente o oposto do que a delegação deveria comprar. Montar
esse contexto à mão, no modelo caro, consome o mesmo trabalho de raciocínio
que a delegação existia para evitar — o orquestrador acaba pagando cota cara
para produzir a entrada de um modelo barato.

O contrato aqui tem quatro campos fixos: objetivo em uma frase, arquivos que
podem (e não podem) ser tocados, critério de aceite, limites de escopo.
Faltar um campo não é detalhe — é sinal de que a tarefa ainda não está fechada
o bastante para ser delegada. Ver [`docs/handoff.md`](docs/handoff.md).

## 3. Critério de aceite sempre executável, nunca um adjetivo

"Deixar o código mais limpo" não é critério de aceite. "Rodar o typecheck sem
erro" é. A diferença não é estilística: um adjetivo exige julgamento
subjetivo sobre se a tarefa terminou; um comando produz um resultado binário
que qualquer um pode reproduzir.

Esse é o problema mais difícil de um sistema agêntico — não gerar um
resultado plausível, mas saber que o agente terminou de verdade, e não apenas
que ele parou de trabalhar e escreveu um relatório dizendo que terminou. Um
relatório descreve intenção; um comando executável descreve resultado.
Validar uma entrega sempre significa rodar o comando de aceite, nunca ler o
resumo que o subagente escreveu sobre si mesmo. Se não existe um comando que
prove o resultado, a tarefa está mal definida ou não é delegável.

## 4. O executor lê o repositório sozinho

O padrão mais caro de delegação é o orquestrador montando contexto manualmente
— lendo arquivos, colando trechos, explicando a estrutura ao redor. Isso
desperdiça exatamente a cota que a delegação existia para proteger: o
orquestrador acaba fazendo o trabalho de exploração que deveria ter sido
repassado.

O executor definido em [`agents/executor.md`](agents/executor.md) recebe o
contrato de quatro campos e tem acesso direto a leitura, edição, execução de
comandos e busca no próprio repositório. Ele investiga por conta própria o
que precisar — padrões ao redor, onde a mudança se encaixa — deslocando o
custo de exploração para o nível de modelo certo (intermediário, não o mais
caro) e liberando o orquestrador para decisões que exigem julgamento de mais
alto nível. O subagente [`agents/explorador.md`](agents/explorador.md) cobre
o caso simétrico: puro trabalho de busca e leitura, no nível mais barato,
retornando sempre um resumo — nunca o conteúdo bruto inteiro, o que anularia
a economia de rodar no modelo barato.

## 5. Isolamento de execução por worktree

Uma tarefa delegada que escreve direto no checkout principal do repositório
arrisca misturar o trabalho do subagente com o que já estava em progresso —
e uma falha de agente vira estrago real na árvore de trabalho. Task que
escreve em repositório com mudanças não commitadas roda em worktree git
separada: pior caso vira uma pasta descartável, não uma reversão manual sob
pressão.

## Os hooks

Os três hooks em `hooks/` reforçam, no nível do harness, disciplinas que o
critério de roteamento e o contrato de handoff já definem — mas que são fáceis
de deixar de seguir sob pressão de tempo:

- **`route-triage.cjs`** injeta o lembrete de classificar a rota em todo
  prompt, lendo a política de roteamento do projeto e respeitando uma
  suspensão explícita marcada nas instruções do projeto (evita forçar a
  triagem em repositórios que decidiram não usá-la).
- **`erros-resolvidos.cjs`** injeta, no início de cada sessão, os bugs
  não-óbvios já diagnosticados naquele projeto — indexados pelo sintoma, não
  pela solução, porque semanas depois o que se tem em mãos é o erro
  acontecendo de novo, não a resposta.
- **`status-lembrete.cjs`** avisa, ao fim de um turno com mudanças não
  commitadas, quando o estado do trabalho não foi salvo em nenhum lugar
  legível na retomada. O hook nunca escreve esse estado sozinho — um hook não
  sabe o que foi feito no turno, e um resumo inventado seria lido depois com
  ar de certeza e daria o passo errado.

`hooks/hooks.json` mostra o wiring de exemplo para os três — os caminhos
precisam ser ajustados para onde o projeto de fato mora.

## Uso

Isto não é um pacote instalável — é referência para adaptar ao seu próprio
harness. Os arquivos `.md` de agentes e comandos seguem o formato de
subagentes/comandos do Claude Code; os hooks são scripts Node.js chamados
pelos eventos do harness (`UserPromptSubmit`, `SessionStart`, `Stop`) via
`hooks.json`. Adapte os nomes de arquivo, os caminhos e os critérios da
tabela de roteamento ao seu próprio conjunto de modelos disponíveis.

## Licença

MIT — ver [`LICENSE`](LICENSE).
