# Protótipo × GDD — relatório de paridade

**08/11/2026 · `prototype/the-hell.html` (22.115 bytes, SHA-256 `83e9fc73…a59c0f9`)**

O código do protótipo bate com a tabela 2.3 do GDD v0.2 em todos os valores conferidos (as 30 linhas da seção 1). Nenhum número do baseline precisa ser corrigido. O código mostra ainda 12 comportamentos que o GDD não registra ou registra errado (P-12 foi achado no porte). Esta tabela é a especificação dos testes de regressão do item F0-04: o porte para TypeScript tem que reproduzir cada linha.

**Origem do arquivo:** zip enviado pelo Rodrigo em 08/11/2026, exportado do artefato publicado na conversa de criação do jogo. Do zip, só entrou no repositório o `the-hell.html`. Os outros arquivos (visualizador do Claude Docs e fontes da Anthropic) não fazem parte do jogo.

**Roda?** Sim. Teste de fumaça (`node tools/prototype-smoke.cjs saida.png`) no Chromium headless: three.js r128 carregado, partida iniciada, jogador andou 4 s, 4 geradores e 3 bônus criados, caçador com 80 de vida, nenhum erro no console. Captura em [`art/prototipo-baseline.png`](art/prototipo-baseline.png).

## 1. Tabela 2.3 × código

L = linha em `prototype/the-hell.html`.

| Sistema | Parâmetro (GDD §2.3) | GDD | Código | L |
| --- | --- | --- | --- | --- |
| Sobrevivente | vida | 100 | 100 | 105 |
| Sobrevivente | andar / correr | 4,0 / 5,4 | 4 / 5,4 | 138 |
| Sobrevivente | stamina: consumo / recarga / recarga em quebra-cabeça | 15 / 14 / 10 | 15 / 14 / 10 | 135, 138 |
| Sobrevivente | bots: andar / fugir | 3,8 / 4,2 | 3,8 / 4,2 | 175–180 |
| Sobrevivente | armadilha | ×0,6 por 3 s | ×0,6 por 3 s | 138, 147 |
| Caçador | vida | 80 | 80 | 107 |
| Caçador | perseguição / patrulha / pressão final | 3,9 / 3,1 / ×1,2 | 3,9 / 3,1 / ×1,2 | 164 |
| Caçador | golpe: alcance / recarga / dano (final) | 1,8 / 1,7 / 15 (18) | 1,8 / 1,7 / 15 (18) | 169 |
| Caçador | detecção | 11 m ou revelado | 11 m ou revelado, em 360° | 162 |
| Caçador | revelação | 28 s, 2 alvos, 3,5 s | 28 s, 2 alvos, 3,5 s | 161 |
| Caçador | alerta por falha | 8 s | 8 s, sem limite de distância | 118 |
| Caçador | dash | 11 m/s, 0,35 s, recarga 15 s, de 5 a 11 m | igual | 164–165 |
| Caçador | projétil | 14 m/s, dano 8, recarga 10 s, de 5 a 16 m | igual (vida útil de 2 s) | 146, 166 |
| Caçador | armadilha | a cada 32 s, raio 0,9 m | igual | 147, 167 |
| Prisão | gaiola | (0, 10), 75 s, 2ª captura = morte | igual | 72, 124–125 |
| Prisão | resgate | 3 s a < 2,4 m; volta com 60 de vida e 4 s imune | igual | 127, 140 |
| Mapa | tamanho | 62×62 m, 4 muros de borda + 11 obstáculos, altura 3,4 m | 15 caixas (4 + 11), altura 3,4 m | 71, 97 |
| Geradores | obrigatórios | 4 em (±22, ±22), 5 quebra-cabeças alternados | igual | 72, 117 |
| Geradores | bônus | 3 em (±27, 0) e (0, −12) | igual | 103 |
| Portão | abertura e saída | 45 s; saída em z < −28 | 45 s; z < −28 e \|x\| < 3,2 | 148–150 |
| Pontos | quebra-cabeça / gerador / bônus | 10 / 40; 25 / 75 | igual | 118 |
| Economia | moedas | 20 + 30 por vitória + pontos; começa com 150 | igual | 58, 156 |
| Loja | skins | 7, de 80 a 250 | 7 (a Padrão é gratuita), de 80 a 250 | 57 |
| Curandeiro | pulso de cura | +45 em raio de 6 m, recarga 10 s | igual | 120 |
| Mecânico | conserto turbo | +1 quebra-cabeça a < 3 m, recarga 14 s | igual | 121 |
| Mecânico | parafuso | 8 m em cone, dano 6, lentidão ×0,5 por 3 s, recarga 6 s só ao acertar | igual (cone de ±53°) | 123 |
| Mecânico | zona de acerto; bot por quebra-cabeça | 0,4; 6 s (10 s padrão) | igual | 117, 180 |
| Atacador | bloqueio | anula 1 golpe por 5 s, recarga 8 s | igual | 122 |
| Atacador | golpe | 3,2 m, dano 12, atordoa 3 s, recarga 5 s | igual | 123 |
| Quebra-cabeça | timing / sequência | marcador a 0,9/s, zona 0,25; 4 setas | igual | 117, 135 |

## 2. Comportamentos fora do GDD

Vão para `data/balance.yaml` (bloco `prototype_extras`) para o porte reproduzir o jogo como ele é.

| # | Comportamento | Código | L | Tratamento |
| --- | --- | --- | --- | --- |
| P-01 | Interagir com gerador a < 2,6 m; desarmar armadilha a < 2 m | `D(g,P)<2.6`, `D(t,P)<2` | 141–142 | parâmetro em dados |
| P-02 | Câmera: FOV 72°, ombro 0,8 m, distância 3,6 m, altura 2,3 m, recuo de 0,3 m contra a parede | `PerspectiveCamera(72…)`, `let d=3.6` | 93, 188 | parâmetro em dados (o GDD §2.1 cita ombro, distância e altura, mas não o FOV) |
| P-03 | Batimento cardíaco a < 20 m, com intervalo de 0,35 + d/20 × 1,1 s | `dh<20` | 155 | parâmetro em dados; a música de tensão do GDD-v0.3 §11 usa 25 m |
| P-04 | Vinheta vermelha cresce a partir de 16 m do caçador | `1-dh/16` | 191 | parâmetro em dados |
| P-05 | Raio de colisão: jogador 0,45 m; bots e caçador 0,5 m | `col(P,.45)`, `col(e,.5)` | 129, 139 | `data/balance.yaml` corrigido (era 0,4) |
| P-06 | Bots Mecânico são imunes a armadilhas | `!(s.cls=='Mecânico'&&s.bot)` | 147 | registrar no GDD: o jogador Mecânico não tem essa imunidade |
| P-07 | O parafuso dos bots acerta sem precisar mirar | `s.bot\|\|…>.6` | 123 | mantém no porte; a IA nova (GDD-v0.3 §8.5) passa a mirar como o jogador |
| P-08 | O golpe do Atacador gasta a recarga mesmo errando; o parafuso do Mecânico só gasta ao acertar | `s.atk=5;if(D(s,H)<3.2)` | 123 | registrar; decisão de balanceamento, não defeito |
| P-09 | A 2ª derrubada mata na hora, sem passar pela gaiola | `if(s.cgn>=1){kill(s)…}` | 125 | confere com "2ª captura = morte" |
| P-10 | Só o Shift esquerdo fecha o quebra-cabeça (o direito não) | `'ShiftLeft'` | 111 | defeito menor; **corrigido no porte** (o Shift direito também sai) |
| P-11 | Os textos do menu estão desatualizados: Curandeiro "(12 s)" e bloqueio do Atacador "(10 s)", mas o código usa 10 s e 8 s | descrição em `CL` | 53, 55 | **defeito**: o texto mostra os valores anteriores à mudança 2.4.2; **corrigido no porte**: o texto lê os números de `data/` |
| P-12 | Um gerador vale **90 pontos** (5 × 10 + 40), não 50 como diz o GDD §2.3; o bônus vale 200 (5 × 25 + 75), como o GDD diz. A mensagem "+50 pontos" mostra só o ganho do último passo | `G.pts+=pp` + `G.pts+=g.b?75:40` | 118 | **achado do porte (08/11/2026)**: o porte segue o código (90); o GDD v0.3 registra a correção |

## 3. Confirmações para o GDD v0.3

- **C-06 confirmada:** a detecção é em 360° (L162). O cone de 90° do GDD é mudança de regra e precisa de recalibração.
- **C-08 confirmada:** o alerta por falha atrai o caçador de qualquer distância (L118). O ruído de 18 m do GDD é mudança de regra.
- **§2.5 confirmada:** a partida acaba quando o jogador escapa ou morre (L151–153), sem esperar os bots.
- **`Math.random`** é usado na simulação (L52: texturas, patrulha, quebra-cabeças, desvio de parede). O porte troca por PRNG com semente (T-02).
- **Tamanho:** 22 KB, não ~45 KB como dizem o GDD-v0.2 §2.5 e o plano. Não muda nada no plano.
