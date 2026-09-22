# Memória de erros — indexada pelo sintoma

O hook [`erros-resolvidos.cjs`](../hooks/erros-resolvidos.cjs) injeta, no início
de cada sessão, o arquivo `ERROS-RESOLVIDOS.md` da raiz do projeto. Este
documento especifica o que vai dentro dele, porque um hook que injeta um arquivo
sem formato definido acaba injetando um diário.

## O problema que isto resolve

Um agente que não lembra rediagnostica. O mesmo limite de upload foi corrigido
três vezes em dias diferentes, cada vez do zero, cada vez com a mesma
investigação. O custo não é o token gasto: é que a segunda correção não sabe por
que a primeira não pegou, e a terceira reintroduz o que a segunda tirou.

Memória conversacional não cobre esse caso. Ela guarda **o que foi dito** —
ótimo para retomar contexto, inútil quando o que se tem em mãos é uma mensagem
de erro e a pergunta é "isto já aconteceu?". O que resolve é um índice pelo
sintoma, porque daqui a um mês o que existe é o erro, não a resposta.

## Formato da entrada

````markdown
## <sintoma exato, como ele aparece na tela>
- **Causa:** <a causa confirmada, nunca a suspeita>
- **Correção:** <comando, ou arquivo:linha>
- **Como reconhecer de novo:** <o sinal que identifica este caso>
- <data>
````

Quatro campos, e cada um responde a uma pergunta diferente na hora do aperto: é
este o meu caso, por que acontece, o que eu faço, e como eu sei da próxima vez.

## As três regras

1. **Indexar pelo sintoma, nunca pela solução.** O título é a mensagem de erro
   como ela aparece, com a grafia que ela tem — não "problema de encoding" mas o
   texto ilegível que apareceu. Busca começa pelo que se tem, e o que se tem é o
   sintoma.

2. **A causa é a confirmada, não a suspeita.** Registrar hipótese como causa é
   pior que não registrar nada: a próxima sessão aplica a correção errada com a
   confiança de quem leu documentação. Bug que fechou sozinho, ou cuja causa não
   ficou clara, não entra.

3. **Bug trivial não entra.** Entra o que custou mais de uma tentativa, ou o que
   um "já resolvi isso antes" explicaria. Arquivo inchado deixa de ser lido, e um
   arquivo que não é lido não é memória — é peso injetado em toda sessão.

## Quando escrever

Ao fechar o bug, sem pedir licença e sem perguntar se vale. A decisão de escrever
tomada depois nunca acontece: no momento em que o erro some, o incentivo para
documentá-lo some junto.

O arquivo é versionado junto do código, porque a correção pertence ao projeto e
não à máquina de quem a encontrou.
