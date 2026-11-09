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

Diagnóstico de 09/11 (1.000 partidas por dificuldade, sementes 1..1000, só medição). **O caçador encontra e acerta, mas o dano não vira captura.**

| Normal | Medido |
| --- | --- |
| Partidas com detecção | 100% (1ª detecção em 20,6 s, mediana) |
| Área vista pelo cone na partida | 85% da arena |
| Entradas em perseguição | ~6,5 por partida |
| Golpes que acertam | 13,6 por partida |
| Capturas | 0,087 por partida |
| Cura sobre dano | 126 de 187 (67% do dano é reposto) |

- Percepção e busca estão iguais ao GDD §8.2. Aumentar o alcance do cone ou mandar o caçador ao gerador em conserto não muda a captura (0,085–0,090).
- O dano se espalha entre 3 sobreviventes e a cura do Curandeiro repõe 2/3 dele; só 41% das partidas têm alguém abaixo de 40 de vida.
- Com uma captura rara, basta um sobrevivente escapar (D-01 b), e o time vence.
- Os mapas do R7 não mudaram o quadro (Pesadelo 12,8–16,6%).
- Corrijo o que eu disse antes: "0,06 perseguição por partida" contava só perseguições que terminam em captura. O caçador não está cego.

Ajustar só pelo simulador não resolve, e a regra C-15 também proíbe isso.

## 4. Decisão sua (escolha uma)

- **E) Conversão de dano em captura** (recomendado): rever o dano do golpe (15) ou a cura do Curandeiro (45 a cada 10 s). É onde o diagnóstico aponta.
- **A) Estamina mais cara**: a estamina já existe (100, gasto 15/s, recuperação 14/s); recuperar mais devagar dá mais golpes ao caçador, mas não resolve a cura.
- **B) D-03**: rever as velocidades.
- **C) Esperar** as 5 partidas suas e do seu filho no staging e decidir com dados humanos.
- **D) Rever D-01 b**: exigir que mais de um sobrevivente escape.

Em todos os casos, peço as **5 partidas no staging** (anote quem venceu e se a perseguição pareceu justa). Esses são os dados do R8.

## 5. Ainda em aberto

- Ligar pilares e saída lateral: depende do PR do cliente (Visual); depois é um PR pequeno.
- Tutorial (D-34) e quebra-cabeças acessíveis: projetados, ainda não implementados.
- D-22 com time de 4: não medido (LACUNA: o sim não tem penalidade de classe repetida).
