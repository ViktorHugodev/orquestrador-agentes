# Roteamento por custo e capacidade

## O problema

Rodar toda tarefa no modelo mais forte disponível é a escolha "segura" óbvia —
e é também a que desperdiça a maior parte da cota. Uma busca de arquivo, um
resumo de documentação ou um lookup mecânico não precisam do mesmo motor que
uma decisão de arquitetura. Tratar as duas coisas igual não é rigor, é
preguiça de classificar.

O oposto também falha: rodar tudo no modelo mais barato para economizar quebra
justamente nas tarefas em que o custo de errar é alto — arquitetura, trade-off,
debug sem hipótese. Nessas, o tempo perdido corrigindo um resultado raso custa
mais do que a diferença de preço entre os modelos.

A saída é uma tabela de critérios explícita, não um "acho que dá pra usar o
barato aqui".

## A tabela

O conjunto abaixo é o que roda aqui hoje: três níveis da família Claude, um CLI
externo de outro fornecedor como revisor e um segundo CLI externo para volume.
Os nomes são concretos de propósito — a tabela só funciona se cada linha apontar
para um motor real com preço real. Adapte os nomes ao seu conjunto; o critério
de cada linha é o que importa. Entre parênteses, o nome curto que o hook de
triagem e o comando `rota` usam para a mesma linha.

| Rota                        | Motor                          | Critério                                                                                                          |
| --------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| exploração (barato)         | Haiku                          | mecânico: busca, leitura, resumo, listagem, lookup de documentação, coleta de contexto                             |
| implementação (intermediário) | Sonnet                       | **default de implementação**: task com escopo definido, refactor, bug com causa clara, multi-arquivo, teste pedido |
| volume / longa (volume)     | CLI externo (Gemini/Antigravity) | tarefa longa ou repetitiva em que poupar cota do provedor principal pesa mais que a integração                     |
| revisão (revisor)           | CLI externo (GPT/Codex)        | review e segunda opinião: crítica de plano, review de diff, diagnóstico quando a rota principal trava. **Não é rota de implementação** |
| arquitetura (topo)          | Opus                           | arquitetura, plano multi-etapa, debug sem hipótese, trade-offs, revisão de diff alheio                             |
| acima do topo               | modelo de maior capacidade     | só o que a rota de arquitetura comprovadamente não fecha; exige tentativa prévia ou justificativa explícita        |

Hierarquia de capacidade: Haiku < Sonnet < Opus < acima do topo. Cada degrau só entra
quando o anterior comprovadamente não resolve — subir de degrau por preguiça de
escrever um contrato curto é erro de rota tanto quanto implementar direto no
nível mais caro.

Por que dois CLIs externos e não só mais um nível da mesma família: **revisão
exige viés diferente**, e um modelo da mesma família tende a concordar com o
raciocínio que ela mesma produziria. E **volume tem economia própria** — crédito
pré-pago que expira sem uso vale menos que cota cara guardada, então a tarefa
longa vai para onde o crédito já está comprado.

## Por que cada degrau existe

**Exploração (Haiku)** existe porque exploração é volume, não julgamento. Buscar um
símbolo, ler um arquivo e resumir, listar um diretório — nada disso exige
raciocínio sobre trade-off. Rodar isso no modelo caro não produz resultado
melhor, só um resultado igual mais caro.

**Implementação (Sonnet)** é o default de implementação porque a maioria das tarefas de
código tem escopo fechado: objetivo claro, arquivos identificáveis, critério de
aceite verificável. Esse é o volume real de trabalho de um sistema agêntico, e
é exatamente onde a diferença de custo entre modelos mais importa.

**Volume/longa (CLI externo)** existe para o caso em que a tarefa é grande ou repetitiva o
bastante para que a integração com o orquestrador principal (montar contrato,
ler diff, validar) custe mais do que rodar direto num CLI externo com mãos
próprias no repositório.

**Revisão (CLI externo de outro fornecedor)** é deliberadamente separada de implementação. O valor de uma
segunda opinião vem de um viés diferente do que gerou o primeiro resultado —
um revisor que herda o raciocínio de quem implementou não está revisando, está
confirmando. Por isso o revisor lê o código sozinho e critica, sem receber o
raciocínio de quem pediu a revisão.

**Arquitetura (Opus) e o nível acima** são reservados para o que os outros níveis comprovadamente não fecham:
arquitetura, decisão com trade-off, debug sem hipótese nenhuma. Subir para
esse nível por hábito, em vez de por necessidade demonstrada, é o mesmo erro
de rota que implementar ali direto — só que mais caro de perceber, porque o
resultado tende a ser bom mesmo quando o nível estava errado.

## Critério de desempate

Na dúvida entre dois degraus, escolher o mais barato. Um contrato mal
dimensionado para baixo volta em minutos, com o erro explícito na mão; um
contrato mal dimensionado para cima gasta cota que não volta e ninguém percebe
o desperdício, porque o resultado saiu bom de qualquer forma.
