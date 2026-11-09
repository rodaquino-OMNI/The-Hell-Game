# THE HELL — Plano do áudio (V5)

**09/11/2026 · ordem de serviço do orquestrador de áudio · base: `main` em `cead60e`**

O áudio carrega o pilar 2 do GDD ("tensão sem gore: o medo vem de som, perseguição e incerteza"). Hoje o jogo só tem bipes de oscilador (`packages/client/src/audio/beeps.ts`, 18 linhas). Este plano entrega música adaptativa em camadas, som espacial com oclusão, telegraph sonoro das habilidades do caçador e mixagem medida. Coordenação com as outras sessões: [`sessoes.md`](sessoes.md). Regras invioláveis: [`plano-fases-1-2.md`](plano-fases-1-2.md) §3. Especificação: GDD v0.3 §11 e `data/balance.yaml` seção `audio`.

## 1. Arquitetura (`packages/client/src/audio/`)

| Módulo | Responsabilidade | Testável sem navegador? |
| --- | --- | --- |
| `engine.ts` | `AudioContext` criado e desbloqueado no primeiro clique; barramentos `music`, `sfx`, `voice`, `ui` → master; `setBusVolume()` com persistência em `localStorage` (try/catch) | parcial (com contexto falso) |
| `music.ts` | 5 stems em loop, sincronizados; troca de camada **no início do próximo compasso** com crossfade de `audio.music.crossfade_bars`; ducking de `audio.ducking_db` em eventos críticos | sim (relógio simulado) |
| `musicState.ts` | função pura `musicStateFor(state, playerId, cfg)` → `ambient | tension | chase | final_pressure | rescue`, com prioridade: pressão final > perseguição > resgate > tensão (caçador a < `tension_radius`) > ambiente. Pura para servir também ao multiplayer da fase 3 (o servidor mandará o sinal de perseguição) | sim |
| `voices.ts` | gerenciador de vozes: no máximo `audio.max_voices` (32); prioridade por tipo (tabela em dados); a 33ª derruba a de menor prioridade e mais antiga | sim |
| `spatial.ts` | `PannerNode` HRTF por voz; ouvinte na câmera; oclusão: se o segmento ouvinte→fonte cruza parede, passa-baixa em `audio.occlusion_lowpass_hz` (800 Hz). Reusar a função de linha de visão do sim (`packages/sim/src/perception.ts`), sem duplicar geometria | sim (a decisão de oclusão) |
| `sfx.ts` | catálogo de efeitos: passos por superfície, respiração ligada à stamina, zumbido do gerador por progresso, batimento cardíaco, telegraph por habilidade do caçador, gerador concluído, falha, resgate, prisão | — |
| `captions.ts` | barramento de legendas de som (GDD v0.3 §12.4: passos de corrida, falha de gerador, grito do caçador, resgate) com direção; a sessão Visual desenha no HUD | sim |

Parâmetros novos vão para `data/balance.yaml` `audio:` com schema: `music.bpm`, `music.beats_per_bar`, prioridades de voz, volume padrão por barramento, catálogo de efeitos por evento. Nenhum número no código.

## 2. Conteúdo sonoro e licenças

- **Música:** stems sincronizados em CC0 quase não existem. Caminho recomendado: **composição procedural autoral** por script determinístico (`tools/audio/compose.ts`), renderizada com `OfflineAudioContext` no Chromium já instalado (Playwright), exportada para WAV e convertida com ffmpeg para MP3. Garante mesmo andamento, tom e duração nos 5 stems, sem risco de licença. Instrumentos podem usar samples CC0. Andamento e tom em dados.
- **Efeitos:** pacotes CC0 (Kenney; OpenGameArt com bloco de licença CC0) ou síntese própria. Conferir a licença **na página de origem de cada arquivo** e registrar linha a linha em `packages/client/public/media/creditos.csv` (arquivo, autor, fonte, licença, URL). Se o host de download for bloqueado pela rede da sessão, não contornar: usar as ferramentas de ambiente e pedir aprovação.
- **Formato:** MP3 (GDD v0.3 C-13); música estéreo 128 kbps, efeitos mono. Carregamento sob demanda por mapa; o download inicial do jogo continua ≤ 15 MB (orçamento do GDD §10.6, medido pela sessão Visual no V7).
- Sem gritos realistas de dor, sem sons de violência gráfica: terror leve, classificação 12+.

## 3. Integração com a simulação

- O áudio só **lê** `GameState` e `GameEvent`. Se precisar de evento novo (ex.: início de telegraph, passo com superfície, mudança de estado do caçador para perseguição), pedir à Frente R: mudança aditiva em `packages/sim/src/types.ts`, revisada pelo agente `simulacao` dela, com a paridade intacta ([`sessoes.md`](sessoes.md) §2).
- Telegraph: o estado de preparo **já existe** (`GameState.hunter.windup`, com `kind`, `t` e `total`; `packages/sim/src/types.ts` ≈ L46 e L160, ligado no v1). O som da habilidade começa quando `windup` aparece, ≥ `hunter.telegraph_min` (0,4 s) antes do efeito. Oclusão usa `lineOfSight(map, a, b)` de `packages/sim/src/perception.ts`.

## 4. Itens e provas

| ID | Item | Agente autor / revisor | Prova |
| --- | --- | --- | --- |
| A-1 | `engine.ts`, barramentos, desbloqueio, persistência de volume | audio / qa | teste unitário; e2e: o contexto inicia depois do clique, sem erros no console |
| A-2 | `musicState.ts` + `music.ts` (troca no compasso, crossfade, ducking) | audio / simulacao (revisa o uso do estado) | teste com relógio simulado: toda troca cai no limite de compasso; prioridades corretas em 10 cenários |
| A-3 | Composição procedural dos 5 stems + `tools/audio/compose.ts` | audio / qa | stems com a mesma duração em compassos inteiros; loop sem estalo (verificação de amostra inicial e final) |
| A-4 | `voices.ts` + `spatial.ts` (HRTF, oclusão) | audio / render (revisa a parte de câmera e geometria) | teste: 33ª voz derruba a de menor prioridade; oclusão liga atrás de parede e desliga na linha livre |
| A-5 | `sfx.ts` + catálogo + telegraph | audio / gameplay | teste: evento de som emitido ≥ 0,4 s antes do efeito, com a simulação headless |
| A-6 | `captions.ts` + API para a Visual | audio / ui-ux | teste do barramento; mensagem à sessão Visual com a API |
| A-7 | `tools/audio/loudness.mjs` + créditos na CI | audio / devops | ffmpeg `ebur128`: música −16 LUFS ±1, pico real ≤ −1 dBTP; CI falha se arquivo de `public/audio` não estiver em `creditos.csv`; passo da CI instala ffmpeg com `apt-get` se faltar |

Ordem: A-1 → (A-2, A-3, A-4 em paralelo) → A-5 → A-6, A-7. Cada item em branch e PR próprios, com o agente autor em worktree isolado e revisão por outro agente.

## 5. Critério de saída do V5

Os 7 itens em `main` com CI verde; jogo no staging com música que muda no compasso conforme o caçador se aproxima e persegue; telegraph audível antes de dash e golpe; loudness dentro da meta; créditos completos; API de volume e legendas entregue à sessão Visual; resumo de 1 página ao Rodrigo (com um vídeo curto ou captura de áudio, se possível) e relato à supervisão.
