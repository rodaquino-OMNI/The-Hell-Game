# THE HELL — Plano da Frente R (regras, IA e balanceamento)

**09/11/2026 · ordem de serviço do orquestrador da Frente R · base: `main` em `cead60e`**

A Frente R entrega o jogo que **joga** como o GDD v0.3: bots que fogem como pessoas, simulador que protege o balanceamento na CI, pontuação completa, dificuldades, a troca para as regras v1 (marco MJ-B) e a calibração com o Rodrigo e o filho. Coordenação com as outras sessões: [`sessoes.md`](sessoes.md). Regras invioláveis: [`plano-fases-1-2.md`](plano-fases-1-2.md) §3.

## 1. Estado de partida (ler o código antes de planejar)

| Peça | Onde | O que já faz |
| --- | --- | --- |
| Regras v1 (R1, PR #13) | `packages/sim/src/game.ts`, `config.ts`, `match.ts`, `perception.ts` | cone de visão com linha de visão, ruído, fim de partida do §3.3 revisto, vida do caçador por dificuldade × time, telegraph, anti-tunnel; tudo atrás de `ruleset: v1` |
| Navegação (R2, PR #14) | `packages/sim/src/nav/*` (`recast.ts`, `grid.ts`, `layout.ts`, `rules.ts`) | navmesh recast + grade A* de reserva; layouts do Pátio; validador `pnpm maps:validate` |
| IA do caçador (R3, PR #17) | `packages/sim/src/ai/hunter.ts`, `ai/utility.ts`, `ai/percept.ts` | percepção 10 Hz, estados do §8.2, utilidade com histerese, loops por dificuldade; `ai.hunter_brain: basic|utility` (padrão `basic`) |
| Bots | `updateBot` em `packages/sim/src/game.ts` (≈ L407) | **ainda os do protótipo** (paridade): fogem a 9 m, consertam, resgatam |
| Simulador | `packages/sim/src/headless.ts`, `tools/sim/run.ts` (`pnpm sim`) | N partidas em workers, mede trava (T-03) e transições; ainda **sem** métricas do §7.6 e sem porta de regressão |
| Testes | `packages/sim/test/*` | paridade (`parity.test.ts`), regras v1 (`rules-v1.test.ts`, fixa o cérebro `basic`), IA, navegação, determinismo |

Leia também os relatórios dos PRs #13, #14 e #17 (corpo do PR e comentários): registram as LACUNAs e decisões técnicas da R1–R3.

## 2. Itens

### R4 — Bots competentes (F1-06; GDD v0.3 §8.5)

- Novo cérebro em `packages/sim/src/ai/bots.ts`, atrás de `ai.bot_brain: prototype | competent` (acrescentar ao schema; padrão `prototype` até a troca do MJ-B). O cérebro do protótipo continua intacto para a paridade.
- Personalidades de `ai.bots.personalities` sorteadas com o PRNG da partida (Cauteloso, Ousado, Altruísta).
- **Fuga competente:** em perseguição, ir ao loop mais próximo da rota de fuga (metadados de loop do mapa, os mesmos que a IA do caçador usa), quebrar linha de visão, usar a habilidade da classe (bloqueio, pulso de cura, parafuso); andar em vez de correr quando a stamina não sustenta a fuga.
- Erro humano: `ai.bots.puzzle_fail_rate` (15%) e reação a ping em `ai.bots.ping_reaction`. Se a simulação ainda não tiver pings (eles vivem no HUD), registrar LACUNA e implementar só a reação a eventos que o sim já emite.
- Mesma informação que um jogador naquela posição teria (snapshot filtrado), mesmas recargas.
- **Prova:** `pnpm sim --n=1000` com `bot_brain: competent`: mediana de tempo em perseguição antes da captura ≥ 15 s; zero travas; testes de cenário (fuga para loop, uso de habilidade, resgate do Altruísta).
- Agentes: `ia` (autor), `qa` (revisor).

### R5 — Simulador na CI (F1-07, Q-01; GDD v0.3 C-15, D-05)

- Estender `tools/sim/run.ts`: métricas do GDD-v0.2 §7.6 por dificuldade e por mapa: taxa de fuga por sobrevivente, vitória do caçador, duração média e mediana, capturas por partida, % de partidas < 3 min, uso de classe (com bots: registrar a distribuição sorteada), mais tempo de perseguição e travas. Saída JSON e Markdown.
- Linha de base versionada em `data/sim/baseline.json` (gerada com semente fixa e documentada) e tolerâncias em `data/balance.yaml` (`sim.regression`: por métrica, piora máxima absoluta).
- `pnpm sim:check`: 200 partidas, compara com a linha de base, **falha se alguma métrica piorar além da tolerância** (porta de regressão; as bandas do §7.6 só viram porta depois do beta, D-05). Tempo máximo: 3 min no runner da CI (usar workers).
- Workflow agendado `sim-nightly.yml`: 10.000 partidas, relatório como artefato, issue automática só se a regressão for detectada.
- Atualizar a linha de base é um PR explícito com o relatório antes/depois e a justificativa.
- Agentes: `qa` (autor), `simulacao` (revisor), `devops` (workflow).

### R6 — Pontuação completa e dificuldades (F1-08, F1-09; GDD v0.2 §7.1–7.3)

- Eventos de pontos do §7.1 no sim (resgate, cura efetiva ≥ 20, bloqueio ou parafuso útil, atordoar, fugir de perseguição > 15 s, desativar armadilha, escapar) e pontos do caçador. Os itens marcados [Proposta] no GDD ficam atrás de flags em dados (`points.events.<nome>.enabled`), ligados por padrão só os [Implementado]; perguntar ao Rodrigo quais ligar (múltipla escolha) antes de mudar o padrão.
- `pointsMult` por dificuldade (já em `SimConfig`) aplicado; moedas = 20 + 30 × vitória + pontos × 1 (D-04).
- Resumo de fim de partida com as 4 categorias (Objetivos, Altruísmo, Sobrevivência, Audácia) e escolha de dificuldade no menu: arquivos novos `packages/client/src/ui/results.ts` e `ui/difficulty.ts`, ligação mínima em `main.ts`, chaves i18n em `score.*` e `difficulty.*` nos 3 idiomas. Avisar a sessão Visual antes do PR e pedir revisão do agente `ui-ux` dela ([`sessoes.md`](sessoes.md) §2).
- **Prova:** teste por evento de pontuação; teste de moedas por dificuldade; e2e da tela de fim.
- Agentes: `gameplay` (autor), `qa` (revisor), `ui-ux` (telas).

### R7-mapas — decisões D-22, D-23 e D-25 (09/11/2026)

- Só no ruleset v1; o layout 0 com `ruleset: prototype` fica intacto (paridade e capturas de referência da Visual).
- D-22: 5º gerador para equipes de 4–5 (`generator.by_team_size`). D-23: 2–3 pilares que formem loops curtos de 8–12 m, como caixas em `walls` do layout resolvido; o validador passa a exigir loop curto. D-25: segunda saída na parede lateral (`exit_x` no mapa e em `crossedExit`).
- Formato final dos campos combinado com a Visual antes do merge (ela passa a desenhar a partir de `g.arena`).
- **Prova:** `pnpm maps:validate` com as novas regras em todas as combinações; testes de saída lateral e de geradores por tamanho de equipe; `pnpm sim:check` sem travas.
- Agentes: `ia` (autor), `simulacao` (revisor). Depois do R4.

### MJ-B — troca para as regras v1

- PR único que muda os padrões: `ruleset: v1`, `ai.hunter_brain: utility`, `ai.bot_brain: competent` (este só se o R4 tiver passado na prova).
- `rules-v1.test.ts` hoje fixa o cérebro `basic`: migrar as asserções do caçador para o cérebro `utility` (ou fixar `basic` explicitamente por teste onde a regra testada não depende da IA). A suíte de paridade passa a fixar `ruleset: prototype` explicitamente e continua verde.
- `pnpm smoke` e `pnpm sim:check` verdes; conferir o staging depois do merge (`/healthz` e `tools/smoke.mjs` contra a URL).
- O anúncio do MJ-B ao Rodrigo espera o marco de arte A3 (sessão Visual). A troca pode ir para `main` antes.
- Agentes: `simulacao` (autor), `qa` (revisor).

### R8 — Calibração (F1-11; GDD v0.3 C-07)

- **Decisão D-16 tomada pelo Rodrigo (09/11/2026): opção (a).** Com D-01 b ("basta 1 escapar"), a meta de balanceamento é a **vitória do caçador por partida em 45–55%** (é o resultado que o jogador sente). A taxa de fuga por sobrevivente fica livre e mais baixa; o R8 mede e registra a faixa que resultar, sem forçá-la para 45–55%. As outras metas do §7.6 (duração 6–8 min, capturas 1,5–2,5, < 5% abaixo de 3 min, uso de classe 20–35%) continuam valendo.
- Relatório do simulador em `docs/balanceamento-v1.md`, ajuste de valores em dados com justificativa, e 5 partidas do Rodrigo e do filho no staging (pedir na sessão). Registrar o resultado e confirmar ou rever D-03 (4,3 m/s).
- Lição do Caçada Sombria (GDD v0.3 C-15): bots não representam pessoas; nenhum ajuste fino só por simulação.
- Agentes: `qa` (autor), `produtor` (relatório e pergunta).

## 3. Ordem

1. R5 (porta de regressão com o cérebro atual) e R4 em paralelo.
2. R6 (sim) em paralelo com o R4; telas do R6 depois.
3. Linha de base do R5 regravada com `competent` (PR explícito).
4. MJ-B (troca de padrões).
5. R8 com a meta da D-16 (vitória do caçador 45–55% por partida).

## 4. Perguntas 1–8 pendentes

O orquestrador Visual enviou ao Rodrigo perguntas 1–8 sobre regras e mapas (valem as recomendadas até a resposta). No início, peça o texto e o estado delas à sessão Visual (`session_01RHvzBkpAz1qJUMgUKvPxkx`) por mensagem e assuma as que tocam regras, IA ou mapas.

## 5. Critério de saída da Frente R

CI verde com `pnpm sim:check` ativo; `ruleset: v1` como padrão no staging; 1.000 partidas por dificuldade sem trava; mediana de perseguição ≥ 15 s; cobertura de `packages/sim` ≥ 90%; R8 registrado com a vitória do caçador por partida em 45–55% (D-16 a); resumo de 1 página ao Rodrigo e relato à supervisão.
