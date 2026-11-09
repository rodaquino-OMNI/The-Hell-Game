# Frente R — resumo para o Rodrigo (09/11/2026)

Regras, IA e balanceamento. Uma página. Números do simulador (`pnpm sim`), não de jogo humano.

## 1. O que entrou em `main`

| PR | Item | O que mudou |
| --- | --- | --- |
| #31 | Docs | Decisões D-20…D-25, D-32 e D-34 registradas no §7; revelação global do gerador (D-21) |
| #36 / #52 | R6 | Pontuação por evento, dificuldade, tela de fim com as 4 categorias |
| #38 | R5 | `pnpm sim:check` no CI (200 partidas) + `sim-nightly` (10.000 partidas) |
| #50 | R4 | Bots aliados competentes (resgatam, consertam, fogem); D-35 e D-36 |
| #69 | MJ-B | v1 virou o padrão (caçador `utility`, bots `competent`) |
| #71 | R8 passo 1 | Ajustes de IA do caçador (busca, projeção, memória) |
| #75 | R7-mapas | 5º gerador, pilares e saída lateral, atrás de chaves em `data/` |

Staging: https://the-hell-staging.fly.dev (v1 por padrão; smoke 3/3). Produção não foi tocada (D-46).

## 2. Critérios de saída

| Critério | Situação |
| --- | --- |
| CI verde com `sim:check` | ✅ |
| v1 padrão no staging | ✅ |
| 1.000 partidas/dificuldade sem travar | ✅ (0 travadas em 12.000) |
| Mediana de perseguição ≥ 15 s | ⚠️ 27,0 s no agregado; no Normal 25,0 s em 1.000 partidas, mas a métrica só conta perseguições que terminam em captura (`chaseEpisodes`, headless.ts:97) |
| Cobertura do sim ≥ 90% | ✅ (99,86% das linhas, 475 testes) |
| Caçador vence 45–55% (D-16) | ❌ Normal 0,0% · Pesadelo 16,6% |

## 3. O problema que sobra: o caçador quase nunca vence

Diagnóstico de 09/11 (1.000 partidas por dificuldade, sementes 1..1000, só medição). **O caçador encontra e acerta, mas quase não captura.**

| Normal | Medido |
| --- | --- |
| Partidas com detecção | 100% (1ª detecção em 20,6 s, mediana) |
| Área vista pelo cone na partida | 85% da arena |
| Entradas em perseguição | ~6,5 por partida |
| Golpes que acertam | 13,6 por partida |
| Capturas | 0,087 por partida |
| Cura sobre dano | 126 de 187 (67% do dano é reposto) |

- Percepção e busca estão iguais ao GDD §8.2. Aumentar o alcance do cone ou mandar o caçador ao gerador em conserto não muda a captura (0,085–0,090).
- O dano se espalha entre 3 sobreviventes e só 41% das partidas têm alguém abaixo de 40 de vida. A cura repõe 2/3 do dano, mas a grade abaixo mostra que mudar a cura quase não altera o resultado.
- Os mapas do R7 não mudaram o quadro (Pesadelo 12,8–16,6%).
- "0,06 perseguição por partida" contava só perseguições que terminam em captura; o caçador não está cego.

### Testes de ajuste (só medição, Normal, 1.000 partidas por célula; tabelas nos comentários do #78)

| Alavanca testada | Faixa | Maior vitória do caçador |
| --- | --- | --- |
| Dano do golpe × cura do Curandeiro (opção E) | golpe 15–34 × cura 45/30/20 | 0,9% |
| Condição de vitória (opção D): maioria escapa, ou caçador vence com 2 capturas | golpe 15 e 20 | 0,5% |

Nenhuma alavanca, sozinha, chega perto dos 45–55%. Em todas as células, a fuga individual fica entre 83 e 99% e **a partida dura 4,3–4,6 min**, abaixo da meta de 6–8 min (§7.6). O gargalo provável é o **ritmo do objetivo**: os bots consertam e saem antes que o caçador acumule dano em alguém. Isso é inferência, e a próxima medição é tempo de conserto, número de geradores e tempo do portão.

Hipótese a conferir com você: o bot competente pode estar consertando mais rápido do que um humano consegue.

Ajustar só pelo simulador não resolve, e a regra C-15 também proíbe isso.

## 4. Decisão sua

- **C) Jogar primeiro** (recomendado): as 5 partidas suas e do seu filho no staging mostram se a partida curta é do bot ou do jogo. Anote quem venceu, quanto durou e se a perseguição pareceu justa.
- Depois das partidas, a alavanca provável é o **ritmo do objetivo** (tempo de conserto, geradores, portão), não o combate.
- **E** (dano/cura) e **D** (condição de vitória) foram medidas e, sozinhas, não resolvem. Podem servir de ajuste fino depois.
- **A** (estamina mais cara) e **B** (velocidades, D-03) ficam como secundárias.

## 5. Ainda em aberto

- Saída lateral ligada (#80). Pilares desligados até explicar os episódios de perseguição de 0,2–0,5 s (troca de alvo em `chaseEpisodes`); golpe com linha de visão (D-50) no #84.
- Tutorial (D-34) e quebra-cabeças acessíveis: projetados, ainda não implementados.
- D-22 com time de 4: não medido (LACUNA: o sim não tem penalidade de classe repetida).
