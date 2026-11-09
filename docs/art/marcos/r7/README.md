# Marco R7-mapas no render: portão lateral e pilares

Capturas de revisão do item R7-mapas (Frente R, PR #75) desenhado pelo cliente: portão e saída lidos da partida
(`GameState.arena`: `gate`, `exitX`/`exitZ`, `gateFacing`), muros e tamanho do mapa efetivo (`cfg.map`).

- Decisões: D-23 (pilares de loop curto, GDD-v0.2 §9.1) e D-25 (saída na parede lateral, GDD-v0.3 §9.3).
- Flags: `maps.v1.short_loop_pillars` e `maps.v1.side_exit` (`data/balance.yaml`) continuam **desligadas** nos dados.
  Nestas capturas elas são ligadas só na página, pelo parâmetro de depuração `?map_flags=short_loop_pillars,side_exit`
  (aceito só com `?debug=1`, `packages/client/src/data.ts`), com `?ruleset=v1`.
- Semente 1234: o layout sorteado é `{generators: 1, cage: 1, exit: 1}`; com `side_exit` a saída 1 vira a lateral oeste,
  portão em (−29, −10), `exitX` −28, `gateFacing` {−1, 0} (o script confere antes de capturar).
- Chromium do Playwright com SwiftShader, 1280×720 com deviceScaleFactor 2, relógio parado, preset medium.
- Gerar de novo: `pnpm build && node tools/art/r7-capturas.mjs docs/art/marcos/r7`

| Arquivo | O que mostra |
| --- | --- |
| `r7-portao-oeste-3p.png` | 3ª pessoa em (−20, −10) olhando para oeste: o portão (vermelho, fechado) de frente, encostado na parede oeste, com a largura correndo em z |
| `r7-portao-oeste-1p.png` | 1ª pessoa em (−21, −10) olhando para oeste: o mesmo portão de frente, sobre a linha da saída (x = −28), fora da parede (x ≤ −30) |
| `r7-portao-oeste-diagonal.png` | 3ª pessoa em (−18, −3) olhando para noroeste: o portão em diagonal, paralelo à parede oeste (girado π/2 por `gateFacing`) |
| `r7-pilar-oeste.png` | 3ª pessoa em (−10, 7) olhando para norte: o pilar de (−10, 0) (1 × 1 m, altura do muro) |
| `r7-pilar-leste.png` | 3ª pessoa em (10, −7) olhando para sul: o pilar de (10, 0) |

Conferência visual (agente RND): nas três vistas do portão ele aparece inteiro, de frente para dentro do pátio, com a
face de trás voltada para a parede oeste (para fora) e sem entrar no muro; nos dois quadros de pilar a coluna aparece
isolada no chão, fora do bloco central.
