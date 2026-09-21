# Handoff: contrato escrito em vez de repasse de contexto

## O problema que isso resolve

A forma óbvia de delegar uma tarefa é jogar o contexto inteiro para o
subagente: colar o arquivo relevante, resumir o histórico da conversa,
explicar o que já foi tentado. Isso parece mais completo do que escrever um
contrato curto — e é exatamente o oposto do que a delegação deveria comprar.

Montar esse contexto à mão consome, no modelo caro, o mesmo trabalho de
raciocínio que a delegação existia para evitar. Se orquestrar uma tarefa exige
reler o arquivo inteiro, decidir o que é relevante e redigir um resumo fiel,
grande parte do valor da execução já foi gasta antes de o subagente começar —
e o orquestrador acabou de pagar a cota cara para produzir a entrada de um
modelo barato.

## O contrato

Delegação aqui tem quatro campos obrigatórios. Faltar um deles não é
detalhe — é sinal de que a tarefa ainda não está fechada o bastante para ser
delegada:

```
OBJETIVO:  uma frase, o resultado esperado
ARQUIVOS:  o que pode ser tocado (e o que NÃO pode)
ACEITE:    um comando verificável — nunca um adjetivo
LIMITES:   o que está fora de escopo
```

Cada campo faz um trabalho específico:

- **OBJETIVO** força a tarefa a caber em uma frase. Se não cabe, ela ainda
  tem mais de uma decisão embutida e precisa ser quebrada antes de delegar.
- **ARQUIVOS** delimita a superfície de mudança sem exigir que o subagente
  releia o repositório inteiro para descobrir onde pode mexer.
- **ACEITE** é o campo que mais frequentemente falta, e é o mais importante —
  ver seção seguinte.
- **LIMITES** existe porque "faça X" tende a virar "faça X e também Y, que
  parecia relacionado" sem essa fronteira explícita.

## Por que o critério de aceite é sempre um comando, nunca um adjetivo

"Deixar o código mais limpo" não é um critério de aceite. "Rodar o typecheck
sem erro" é. A diferença não é estilística: um adjetivo exige que alguém — o
subagente ou quem revisa depois — julgue subjetivamente se a tarefa terminou.
Um comando produz um resultado binário que qualquer um pode reproduzir.

Esse é o problema mais difícil de um sistema agêntico: saber que o agente
terminou de verdade, e não apenas que ele parou de trabalhar e escreveu um
relatório de que terminou. Um relatório descreve intenção. Um comando
executável descreve resultado. Validar delegação sempre significa rodar o
comando de aceite — não ler o resumo que o subagente escreveu sobre si mesmo.

Se não existe um comando que prove o resultado, uma de duas coisas é verdade:
a tarefa está mal definida, ou ela não é uma tarefa delegável (é uma decisão
de arquitetura, por exemplo, que não tem "comando de aceite" possível).

## Por que o executor lê o repositório sozinho

O padrão mais caro de delegação é o orquestrador montando contexto à mão:
lendo arquivos, colando trechos, explicando estrutura. Isso é o oposto do
propósito de delegar — o orquestrador acaba fazendo o trabalho de exploração
que deveria ter sido passado adiante.

Um executor com acesso direto a leitura, edição, execução de comandos e busca
no repositório recebe o contrato de quatro campos e investiga por conta
própria o que precisar: como o código ao redor está estruturado, que padrões
seguir, onde exatamente a mudança se encaixa. Isso desloca o custo de
exploração para o nível de modelo certo — intermediário, não o mais caro — e
libera o orquestrador para focar em decisões que exigem julgamento de mais
alto nível.

## Validar o retorno

Ler o **diff**, não o relatório do subagente. O relatório é a versão que o
subagente conta sobre si mesmo; o diff é o que de fato mudou. Depois, rodar o
comando de aceite. Se falhar, uma rodada de correção com o erro literal
colado de volta costuma resolver. Se falhar de novo, o padrão é recuperar a
tarefa e decidir no nível acima — uma terceira rodada de ida e volta já custa
mais do que fazer diretamente.
