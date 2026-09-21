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

| Nível        | Critério                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------ |
| barato        | mecânico: busca, leitura, resumo, listagem, lookup de documentação, coleta de contexto     |
| intermediário | **default de implementação**: task com escopo definido, refactor, bug com causa clara, multi-arquivo, teste pedido |
| volume/longa | tarefa longa ou repetitiva em que poupar cota pesa mais que a integração — CLI externo, execução direta no repositório |
| revisor      | review e segunda opinião: crítica de plano, review de diff, diagnóstico quando o nível principal trava. **Não é rota de implementação** |
| topo         | arquitetura, plano multi-etapa, debug sem hipótese, trade-offs, revisão de diff alheio      |

Hierarquia de capacidade: barato < intermediário < topo. Cada degrau só entra
quando o anterior comprovadamente não resolve — subir de degrau por preguiça de
escrever um contrato curto é erro de rota tanto quanto implementar direto no
nível mais caro.

## Por que cada degrau existe

**Barato** existe porque exploração é volume, não julgamento. Buscar um
símbolo, ler um arquivo e resumir, listar um diretório — nada disso exige
raciocínio sobre trade-off. Rodar isso no modelo caro não produz resultado
melhor, só um resultado igual mais caro.

**Intermediário** é o default de implementação porque a maioria das tarefas de
código tem escopo fechado: objetivo claro, arquivos identificáveis, critério de
aceite verificável. Esse é o volume real de trabalho de um sistema agêntico, e
é exatamente onde a diferença de custo entre modelos mais importa.

**Volume/longa** existe para o caso em que a tarefa é grande ou repetitiva o
bastante para que a integração com o orquestrador principal (montar contrato,
ler diff, validar) custe mais do que rodar direto num CLI externo com mãos
próprias no repositório.

**Revisor** é deliberadamente separado de implementação. O valor de uma
segunda opinião vem de um viés diferente do que gerou o primeiro resultado —
um revisor que herda o raciocínio de quem implementou não está revisando, está
confirmando. Por isso o revisor lê o código sozinho e critica, sem receber o
raciocínio de quem pediu a revisão.

**Topo** é reservado para o que os outros níveis comprovadamente não fecham:
arquitetura, decisão com trade-off, debug sem hipótese nenhuma. Subir para
esse nível por hábito, em vez de por necessidade demonstrada, é o mesmo erro
de rota que implementar ali direto — só que mais caro de perceber, porque o
resultado tende a ser bom mesmo quando o nível estava errado.

## Critério de desempate

Na dúvida entre dois degraus, escolher o mais barato. Um contrato mal
dimensionado para baixo volta em minutos, com o erro explícito na mão; um
contrato mal dimensionado para cima gasta cota que não volta e ninguém percebe
o desperdício, porque o resultado saiu bom de qualquer forma.
