# THE HELL

Jogo assimétrico de fuga e perseguição para o navegador: 1 caçador contra 1 a 5 sobreviventes, terror leve sem gore, estética PS1, partidas de 5 a 9 minutos.

## Documentos

| Documento | O que é | Estado |
| --- | --- | --- |
| [`docs/GDD-v0.2.md`](docs/GDD-v0.2.md) | Game Design Document original (07/11/2026), fonte canônica | congelado |
| [`docs/GDD-v0.3.md`](docs/GDD-v0.3.md) | Delta sobre o v0.2: IA, mapas, gráficos, áudio, UI, arquitetura e contradições resolvidas | aguarda aprovação |
| [`docs/art-bible.md`](docs/art-bible.md) | Direção de arte: paleta, silhuetas, testes de legibilidade, marcos de arte | marco A1, aguarda o filho |
| [`docs/prototipo-paridade.md`](docs/prototipo-paridade.md) | Protótipo × GDD: paridade linha a linha e comportamentos fora do GDD | referência da fase 0 |
| [`docs/plano-construcao.md`](docs/plano-construcao.md) | Fases, WBS, caminho crítico, orçamento, portões e decisões pendentes | aguarda aprovação do Rodrigo |

## Dados e ferramentas

- `prototype/the-hell.html`: protótipo jogável original (abrir no navegador). `node tools/prototype-smoke.cjs saida.png` roda um teste de fumaça.
- `data/balance.yaml`: todos os números de jogo e de sistema (nada de número no código).
- `data/art/palette.json`: tokens de cor de 15 bits.
- `node tools/art/palette-check.mjs --md`: testa contraste (WCAG 2.2) e distinção sob daltonismo simulado; sai com erro se falhar.
- `node tools/art/silhouettes.mjs`: gera a folha de silhuetas-conceito em `docs/art/`.

## Stack decidida

Three.js + TypeScript no cliente, servidor autoritativo Colyseus, hospedagem só no Fly.io, custo até US$ 10/mês (mesma base do Caçada Sombria).
