---
name: verifica
description: >
  Verificação adversarial de fatos por um modelo de outro fornecedor. Quebra o
  texto em afirmações checáveis e devolve um veredito por afirmação — confirmado,
  refutado, impreciso, desatualizado ou não verificável — com fonte. Use antes de
  publicar qualquer texto com número, data, preço, citação ou alegação técnica,
  e para auditar afirmação do próprio orquestrador.
---

# verifica — quem afirmou não verifica

Confirmar fato não é pesquisar sobre um tema. Pesquisa aceita narrativa;
verificação exige um veredito por afirmação e uma fonte por veredito.

O verificador é um modelo de outro fornecedor, com busca própria, que chega sem
saber o que o autor queria que fosse verdade. Releitura do próprio texto tende a
confirmá-lo: o viés que produziu o erro é o mesmo que vai avaliá-lo. É a mesma
razão pela qual o critério de aceite é um comando e não o relatório do subagente
sobre si mesmo.

## Fluxo

### 1. Extrair as afirmações — o orquestrador

Quebrar o texto em afirmações **atômicas e checáveis**, uma por linha,
numeradas. Só entra o que pode ser falso:

| Entra                                      | Não entra                        |
| ------------------------------------------ | -------------------------------- |
| número, data, preço, versão, percentual    | opinião ("é a melhor abordagem") |
| citação atribuída a alguém                 | preferência de estilo            |
| alegação técnica ("X suporta Y desde Z")   | promessa futura                  |
| relação causal ("A fez B cair")            | tautologia                       |

Zero afirmação checável: dizer isso e parar. Não inventar trabalho para
justificar a chamada.

### 2. Verificar — o modelo de outro fornecedor

Uma chamada para o lote inteiro. Lista longa ou texto crítico: rodar em
segundo plano. O prompt exige postura adversarial e formato fechado:

```
Verifique cada afirmação abaixo de forma independente e ADVERSARIAL.

Para cada uma, busque ativamente evidência que a REFUTE antes de aceitá-la.
Uma afirmação só é CONFIRMADA se você encontrou fonte primária ou
autoritativa que a sustente — "parece plausível" e "é consenso geral" NÃO
são confirmação.

Responda SÓ nesta tabela, uma linha por afirmação, sem introdução:

| # | Veredito | Evidência (1 linha) | Fonte (URL ou nome+data) |

Vereditos permitidos, e só estes:
- CONFIRMADO — fonte autoritativa sustenta
- REFUTADO — fonte autoritativa contradiz
- IMPRECISO — parte verdadeira, parte errada; diga qual parte falha
- DESATUALIZADO — já foi verdade; diga desde quando não é
- NÃO VERIFICÁVEL — não achou fonte confiável (isto NÃO é o mesmo que falso)

Se a fonte for o próprio texto sendo verificado, ou outro conteúdo gerado
por IA, o veredito é NÃO VERIFICÁVEL. Não preencha fonte com memória sua.

Afirmações:
1. <...>
```

### 3. Consolidar — o orquestrador

Reportar nesta ordem: **refutado → impreciso → desatualizado → não verificável
→ confirmado.** O que está errado vem primeiro; o que passou é rodapé. Para
cada problema: a afirmação, o que ela deveria dizer, a fonte. Fechar em uma
linha: `N afirmações · X confirmadas · Y problemas`.

## Regras

- **Não verificável não vira falso.** Ausência de fonte é ausência de fonte.
  Tratar como refutação produz uma correção errada, que é pior que a dúvida
  original.
- **Veredito que contradiz o texto não obriga automaticamente.** Havendo fonte
  melhor, manter a afirmação — com a fonte à vista. O verificador também erra,
  e aceitar tudo que ele diz só troca a autoridade de lugar.
- **Nunca enviar segredo, credencial ou dado de cliente** no texto a verificar.
  Trocar por placeholder antes.
- **Formato que falha duas vezes vira relatório de falha, não remendo.** Se o
  verificador devolver prosa em vez da tabela, reenviar uma vez exigindo o
  formato; na segunda, reportar o que veio e dizer que o formato falhou.
  Completar a tabela à mão fabrica veredito — o pior defeito possível numa
  ferramenta cujo produto é confiança.

## Quando não usar

- Fato trivial e estável: o round-trip custa mais do que vale.
- Código: executar é verificação mais forte que perguntar a um modelo.
- Algo que só a base do próprio projeto responde: `grep` vence busca na web.
