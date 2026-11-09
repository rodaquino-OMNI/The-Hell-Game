# Frente R — resumo para o Rodrigo (09/11/2026)

Regras, IA e balanceamento. Uma página. Números do simulador (`pnpm sim`), não de jogo humano.

## 1. O que entrou em `main`

| PR | Item | O que mudou |
| --- | --- | --- |
| #31 | Docs | Decisões D-20…D-25, D-30, D-31, D-34, D-35 registradas no §7 |
| #36 | R4 | Bots aliados competentes (resgatam, consertam, fogem) |
| #38 | R5 | `pnpm sim:check` no CI (200 partidas) + `sim-nightly` (10.000 partidas) |
| #50 / #52 | R6 | Pontuação por evento, moedas de vitória, tela de fim, dificuldades |
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
| Mediana de perseguição ≥ 15 s | ✅ (base 18,4 s, grupo Normal) |
| Cobertura do sim ≥ 90% | ✅ (99,86% das linhas, 475 testes) |
| Caçador vence 45–55% (D-16) | ❌ Normal 0,0% · Pesadelo 16,6% |

## 3. O problema que sobra: o caçador quase nunca vence

Com bots competentes, o caçador captura 0,09 sobrevivente por partida no Normal. A causa é estrutural, não de IA:
- basta um sobrevivente escapar para o time vencer (D-01 b);
- o caçador persegue a 4,3 m/s e o sobrevivente corre a 5,4 m/s;
- os mapas do R7 não mudaram o quadro (Pesadelo 12,8–16,6%).

Ajustar só pelo simulador não resolve, e a regra C-15 também proíbe isso.

## 4. Decisão sua (escolha uma)

- **A) Estamina na corrida** (recomendado): o sobrevivente cansa e o caçador alcança. É o padrão do gênero e não muda a condição de vitória.
- **B) D-03**: rever as velocidades.
- **C) Esperar** as 5 partidas suas e do seu filho no staging e decidir com dados humanos.
- **D) Rever D-01 b**: exigir que mais de um sobrevivente escape.

Em todos os casos, peço as **5 partidas no staging** (anote quem venceu e se a perseguição pareceu justa). Esses são os dados do R8.

## 5. Ainda em aberto

- Ligar pilares e saída lateral: depende do PR do cliente (Visual); depois é um PR pequeno.
- Tutorial (D-34) e quebra-cabeças acessíveis: projetados, ainda não implementados.
- D-22 com time de 4: não medido (LACUNA: o sim não tem penalidade de classe repetida).
