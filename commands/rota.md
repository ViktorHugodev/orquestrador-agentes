---
name: rota
description: >
  Classifica uma task e JÁ dispara o executor certo com o contrato montado, em
  vez de devolver a classificação para o usuário agir. Use quando alguém disser
  "/rota <task>", "delega isso", "manda pro modelo certo", "quem faz isso?", ou
  quando uma task de implementação chegar sem destino definido. Substitui
  trocar o modelo da sessão na mão.
---

# rota

Monta o contrato e dispara. **Classificar sem disparar não é usar esta skill** —
é o problema que ela existe para resolver.

## Por que existe

A triagem por custo/capacidade estava sendo executada à mão: trocar o modelo da
sessão custa dois cliques, escrever um contrato de delegação custa um
parágrafo. O caminho barato venceu, e a implementação passou a rodar direto no
modelo caro — o erro de rota que a própria política de roteamento proíbe.

A correção não é disciplina, é tirar o parágrafo do caminho. Aqui o
orquestrador escreve o contrato a partir do que já está no contexto; o custo
para quem pede volta a ser dois cliques.

## Fluxo

### 0. A rota foi nomeada? Então a rota está decidida

Se a primeira palavra do argumento for o nome de uma rota específica (ex:
`haiku`, `sonnet`, `opus`, ou o nome de um dos CLIs externos), isso é
**ordem, não sugestão**. Não
reclassificar, não "melhorar" a escolha, não cair num degrau mais barato porque
a task pareceu simples. Quem pediu conhece o custo e escolheu pagá-lo —
discordar aqui é trocar a decisão dele pela sua sem avisar.

Discordar às claras ou obedecer calado: se a rota pedida for claramente errada,
dizer em uma linha por quê **e executar assim mesmo**. O que não pode é rotear
para outro lugar e anunciar como se fosse a rota pedida.

Pré-coleta é permitida, o anúncio é que não pode mentir. Mandar o subagente
barato juntar contexto antes de gastar o modelo caro é o fluxo certo — mas o
anúncio continua sendo o da rota pedida:

```
[ROTA → opus | <motivo>] — antes, subagente barato coleta <o quê>
```

Anunciar a rota barata quando foi pedida a cara é o erro que esta seção existe
para impedir: da tela de quem pediu, o pedido simplesmente sumiu.

### 1. Classificar

| Rota           | Quando                                                                 | Como disparar                             |
| -------------- | ----------------------------------------------------------------------- | ------------------------------------------ |
| barato          | buscar, ler, resumir, listar, coletar contexto                          | Agent `explorador`, modelo econômico explícito |
| **intermediário** | **default de implementação**: escopo fechado, refactor, bug com causa | Agent `executor`, modelo intermediário explícito |
| revisor externo | review, crítica de plano, segundo diagnóstico                           | CLI externo em modo read-only              |
| volume/longa    | tarefa longa onde poupar cota pesa mais que integração                  | agente de CLI dedicado                     |
| topo            | arquitetura, plano, trade-off, debug sem hipótese                       | **fica com o orquestrador, não delega**    |

Os nomes das rotas são os mesmos do hook de triagem; a tabela completa, com o
motor concreto de cada linha, está em [`docs/routing.md`](../docs/routing.md).

Na dúvida entre dois degraus, escolher o mais barato: contrato mal dimensionado
para baixo volta em minutos, para cima gasta cota que não volta.

### 2. Fechar o contrato antes de disparar

Sem os quatro campos abaixo, não dá para delegar — e a falta de um deles é sinal
de que a task não está fechada. Fechar primeiro, delegar depois:

```
OBJETIVO:  uma frase, o resultado esperado
ARQUIVOS:  o que pode ser tocado (e o que NÃO pode)
ACEITE:    um comando verificável — nunca um adjetivo
LIMITES:   o que está fora de escopo
```

`ACEITE` é o campo que costuma falhar. "Deixar o código mais limpo" não é
aceite; um comando de build/test sem erro é. Se não existe comando que prove o
resultado, ou a task está mal definida, ou ela não é delegável.

### 3. Disparar

Uma chamada, modelo **sempre explícito**. Sem isso o subagente cai no default
global do ambiente e uma task de implementação vira o modelo barato em
silêncio — falha cara justamente por ser silenciosa.

Task que escreve em repositório com trabalho não commitado: isolar em worktree
separada. Pior caso vira pasta descartável.

### 4. Validar o retorno

Ler o **diff**, não o relatório do subagente — relatório descreve intenção,
diff mostra o que foi feito. Rodar o comando de `ACEITE`. Se falhou, uma rodada
de correção com o erro literal colado; se falhar de novo, puxar de volta e
decidir no nível de cima, porque a terceira rodada de ida e volta já custou
mais que fazer direto.

## Quando NÃO delegar

- Task de uma linha: o contrato custa mais que a edição.
- Task que depende de algo vivo da sessão e não cabe num contrato escrito.
- Arquitetura, trade-off, decisão. Isso fica com quem orquestra.

Nesses casos, dizer que não delegou **e por quê**. Silêncio aqui é o que faz a
regra apodrecer sem ninguém notar.

## Formato da resposta

Uma linha ao disparar: `[ROTA → <rota> | <motivo em 3 palavras>] disparado: <o que>`.
Quando a rota foi nomeada por quem pediu, o `<rota>` anunciado é a dele —
sempre, mesmo que a primeira coisa a rodar seja uma coleta no modelo barato
(ver seção 0).
Depois, ao voltar: o veredito do aceite e o que mudou. Não narrar o contrato
inteiro — ele já foi para o subagente, repeti-lo no chat é pagar o texto duas
vezes.
