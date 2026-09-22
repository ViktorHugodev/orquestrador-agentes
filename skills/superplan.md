---
name: superplan
description: >
  Planejamento com revisão adversarial cruzada. O modelo da sessão arquiteta a
  solução, envia o plano para um modelo de outro fornecedor criticar, discute
  os pontos em até 2 rodadas e consolida a decisão — que continua sendo de quem
  planejou. Use em decisão de arquitetura de alto impacto.
---

# superplan — revisão adversarial entre fornecedores

O revisor é um modelo de **outro fornecedor**, rodando por CLI própria, com
acesso de leitura ao repositório e nenhum acesso ao raciocínio que produziu o
plano. Essa é a característica que importa: pedir a crítica ao mesmo modelo que
escreveu o plano produz concordância educada, porque ele já aceitou as próprias
premissas. Um revisor que não herdou o raciocínio é o único que consegue atacar
a premissa em vez do detalhe.

O preço é integração: cada fornecedor tem CLI, sandbox e formato de saída
próprios, e a seção de armadilhas no fim deste arquivo é o custo real disso,
medido em rodadas perdidas.

## Pré-requisito

A CLI do revisor instalada e autenticada. Indisponível: avisar e planejar solo,
nunca fingir que a crítica aconteceu.

## Fluxo

### 1. Draft

Plano inicial: objetivo, contexto mínimo, abordagem proposta, alternativas
descartadas **com o motivo**, riscos, pontos de incerteza. Marcar onde se quer
contraditório: `[DEBATER: ...]`. Sem esses marcadores a crítica se espalha pelo
que é fácil criticar, não pelo que está em dúvida.

### 2. Crítica

Salvar **só o plano** em arquivo. A instrução ao revisor vai no prompt, nunca
dentro do arquivo — o motivo está em "Armadilhas".

```bash
codex exec -m gpt-5.6-sol --sandbox read-only --skip-git-repo-check \
  -C <dir-do-plano> -o <dir>/critica.md \
  "Leia <arquivo-do-plano>. Você é revisor crítico de arquitetura.
   NÃO reescreva o plano, NÃO edite nenhum arquivo, NÃO leia os arquivos de
   contexto do repositório — responda só no stdout. Para cada ponto:
   CONCORDO / DISCORDO (com cenário concreto de falha) / FALTOU (risco não
   coberto). Priorize os 3 pontos mais importantes. Direto, sem elogios."
```

Ler `critica.md`: é a resposta final limpa, sem os logs da CLI.

Escolha do modelo revisor, anunciada junto com a crítica:

| Modelo          | Quando                                                          |
| --------------- | --------------------------------------------------------------- |
| `gpt-5.6-sol`   | default de crítica de arquitetura (complexo, ambíguo, alto valor) |
| `gpt-5.6-terra` | plano menor e pragmático, onde o modelo topo é desperdício        |
| `gpt-5.6-luna`  | **não serve de crítico** — é modelo de tarefa repetível           |

Com esforço de raciocínio alto, a referência medida é ~40s e ~30k tokens para
um plano de cinco linhas. Plano real custa minutos: avisar antes de disparar.

### 3. Debate — no máximo 2 rodadas

Para cada DISCORDO ou FALTOU relevante: aceitar e ajustar o plano, ou rejeitar
com justificativa de uma a duas linhas. Divergência que sobrevive a duas
rodadas vira risco aberto registrado, não uma terceira rodada. Debate que não
converge em duas rodadas não converge em quatro — converge em cansaço.

### 4. Decisão

O plano final carrega uma seção obrigatória:

- **Contribuições do revisor:** aceitas, com o ajuste feito / rejeitadas, com o
  motivo em uma linha.
- **Riscos abertos:** as divergências não resolvidas.

Essa seção é o que impede a revisão de virar teatro. Sem ela não há como saber
depois se a crítica mudou alguma coisa.

## Armadilhas — verificadas em execução

Cada uma custou uma rodada real. Não são precaução teórica.

- **A instrução vai no prompt, não no arquivo.** A CLI lê o arquivo através do
  shell do sistema, que em Windows decodifica UTF-8 como Latin-1: "Você é
  revisor crítico" chega como "VocÃª Ã© revisor crÃ­tico". O modelo tolera,
  mas a instrução que governa a crítica não pode depender dessa tolerância.
  Plano no arquivo, instrução no prompt — o prompt não passa pelo shell.
- **Sandbox somente-leitura não impede a tentativa de escrita.** O revisor
  tenta gravar a crítica em arquivo, recebe o erro e gasta uma rodada nisso.
  "NÃO edite arquivos, responda no stdout" evita a tentativa.
- **O revisor herda as instruções persistentes da própria CLI** e sai lendo
  arquivos de contexto do repositório por conta própria. Em repositório real
  isso é contexto irrelevante pago em token. Vedar no prompt.
- **Gravar a saída em arquivo em vez de parsear o stdout.** A saída da CLI vem
  misturada com banner, log de execução e contagem de tokens; a flag de output
  grava só a mensagem final.
- **A flag de sandbox é obrigatória, e o default pode ser o oposto.** Config
  global de agente costuma vir em "nunca pedir aprovação" com acesso total ao
  disco — combinação conveniente para o dia a dia e perigosa aqui. Omitir a
  restrição entrega escrita irrestrita, sem prompt, a um processo que só
  precisa ler.

## Regras

- A decisão final é de quem planejou. O revisor contribui, não decide.
- Nunca enviar segredo ou credencial no prompt ao revisor.
- Enviar o plano, não o código: contexto de implementação vira bullets.
- Uma rodada de debate por padrão; a segunda só para discordância estrutural.

## Isto não é review de código

Para revisar um diff pronto, a CLI do revisor tem subcomando dedicado e o
fluxo é outro: ele lê o repositório sozinho, sem plano intermediário.
