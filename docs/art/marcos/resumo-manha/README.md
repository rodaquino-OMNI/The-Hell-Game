# Resumo da manhã — capturas do staging

- URL: https://the-hell-staging.fly.dev/
- Versão no staging (`GET /healthz` → `version`): `dd98a89043317b005a94931decf42b8d718f6778` (merge do PR #72; contém `18a6c4c`, PR #68 — conferido com `git merge-base --is-ancestor`)
- Data e hora: 2026-11-09, capturas entre 06:30:17Z e 06:30:41Z (UTC)
- Navegador: Chromium headless do Playwright (`chromium.launch()` sem opções), viewport 1280×720, `deviceScaleFactor: 2` (PNG 2560×1440), `locale: pt-BR`
- Idioma: pt-BR detectado pelo navegador (`navigator.language` = `pt-BR`, sem `?lang=` e sem escolha salva em `thehell.lang`; ordem em `packages/client/src/i18n/index.ts`, linha 2); `<html lang="pt-BR">`
- Regras: v1, o padrão (`ruleset: v1` em `data/balance.yaml`, linha 14); nenhuma captura passou `?ruleset=`
- `?debug=1`: **não** em `menu.png`; **sim** em `partida.png` e `fim.png` (ganchos `window.__thehell*`, `packages/client/src/debug-hooks.ts`)

| Imagem | O que mostra |
|---|---|
| `menu.png` | Menu principal carregado, sem `?debug=1`: título, idiomas (pt-BR marcado), classes (Curandeiro), dificuldade (Normal), botão COMEÇAR habilitado, moedas e ajuda de controles. |
| `partida.png` | Partida iniciada pelo teclado (foco em COMEÇAR + Enter), 3ª pessoa: o caçador iluminado pela lanterna à frente e à direita do Curandeiro, legenda "Passos pesados: o caçador ×13" com seta "à frente" no HUD de legendas. O caçador foi mantido a 5 m à frente e 1,4 m ao lado do jogador por um laço de `requestAnimationFrame` que reescreve `hunter.x/z/a` (gancho `__thehell`); sem isso a IA sai do cone ou colide com o modelo do jogador. |
| `fim.png` | Tela de fim de partida v1: "VOCÊ ESCAPOU!", tempo, moedas, tabela de pontuação (Objetivos, Altruísmo, Sobrevivência, Audácia, Total), resultado da equipe e botão "Jogar de novo" com foco. O fim foi forçado pondo todos os sobreviventes em `st = "out"` pelo gancho (fim por `all_terminal`, `packages/sim/src/match.ts`), por isso a pontuação é 0 e o tempo é 7 s. |

Console do navegador sem erros nem `pageerror` durante as três capturas.
