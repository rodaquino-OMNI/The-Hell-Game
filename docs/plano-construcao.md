# THE HELL — Plano de construção da v1.0

**08/11/2026 · aprovado (PR #1 integrado) · decisões registradas na seção 7**

A v1.0 (GDD-v0.2 §0, com o delta do [GDD v0.3](GDD-v0.3.md)) sai em 7 fases e 55 itens, construída por 10 agentes especialistas num ciclo de PR → CI → staging → produção. O custo de hospedagem estimado é de US$ 6 a 8 por mês, dentro do teto de US$ 10. A estimativa de calendário é de 18 a 29 semanas até o soft launch, contra 8 a 10 meses do GDD para uma equipe humana; quem define o ritmo são os portões humanos (aprovação de arte, playtests com pessoas), não a escrita de código.

Estado: plano aprovado e todas as decisões tomadas (seção 7). Próximo passo: o filho aprova a revisão 2 das silhuetas (marco A1) e começa a fase 0.

---

## 1. Fases e critérios de saída

As fases são as do GDD-v0.2 §17.1. Os critérios de saída são os do GDD, mais as verificações que a CI faz.

| Fase | Objetivo | Critério de saída (verificado por) | Semanas |
| --- | --- | --- | --- |
| 0 | Monorepo, CI, deploy em staging, dados com schema, porte do protótipo | paridade com a tabela 2.3 (testes de regressão); CI verde; staging no ar | 1–2 |
| 1 | Simulação determinística, regras completas, IA com navmesh, mapa 1, HUD, simulador | partida offline completa; cobertura ≥ 90% em `packages/sim`; 1.000 partidas sem trava | 3–5 |
| 2 | Vertical slice visual: shader PS1, modelos, animação, áudio, tutorial | orçamentos de render na CI; 60 FPS em UHD 620 (medição manual); marcos A2 e A3 aprovados | 3–5 |
| 3 | Multiplayer autoritativo, caçador humano, filas, contas, loja no servidor, UI completa | 5 clientes a 150 ms e 5% de perda sem divergência (Playwright + netem); marco A4 | 4–6 |
| 4 | Conteúdo: mapas 2 e 3, Batedor, Protetor, caçadores 2 e 3, ranked, quebra-cabeças | simulador dentro da porta (D-05); marco A5 | 3–5 |
| 5 | Beta fechado, calibração com pessoas, otimização, revisão LGPD | retenção D1 > 30% no beta (GDD §17.1) | 4–6 |
| 6 | Soft launch e live-ops | temporada 1 publicada | contínuo |

## 2. Estrutura de trabalho (WBS)

Cada item vira uma issue e um ou mais PRs curtos. **Definition of Ready:** critério de aceite escrito, dependências prontas, parâmetros em `data/`. **Definition of Done:** PR revisado por agente diferente do autor, CI verde, verificação da coluna "Prova" passando, changelog atualizado. Siglas de agentes na seção 6.

### Fase 0 — Fundação

| ID | Item (backlog GDD) | Depende de | Agente | Prova |
| --- | --- | --- | --- | --- |
| F0-01 | Monorepo pnpm + Vite + Vitest + lint (T-01) | — | DEV | `pnpm build && pnpm test` na CI |
| F0-02 | CI: lint, tipos, testes, build, paleta, varredura de segredos; Dependabot | F0-01 | DEV | workflow verde no PR; PR com segredo de teste é bloqueado |
| F0-03 | `data/` com schema, YAML → JSON, recarga no dev (G-01) | F0-01 | SIM | teste: trocar valor no YAML muda o jogo sem recompilar |
| F0-04 | Porte do protótipo para TypeScript modular | F0-03 | GAM | testes de regressão com cada linha de `docs/prototipo-paridade.md` |
| F0-05 | Apps do Fly (staging e produção), Dockerfile, deploy de staging a cada merge, produção com aprovação, rollback documentado e testado 1 vez | F0-02 | DEV | URL de staging responde `/healthz`; registro do rollback no `docs/runbook.md` |
| F0-06 | Agentes e skills em `.claude/` (Etapa D) | aprovação deste plano | PRO | um arquivo por agente com escopo, ferramentas e critério de saída |

### Fase 1 — Jogo completo offline

| ID | Item | Depende de | Agente | Prova |
| --- | --- | --- | --- | --- |
| F1-01 | Simulação determinística, passo 1/60 s, mulberry32 (T-02) | F0-04 | SIM | mesmo hash em 100 execuções |
| F1-02 | Regras §3: fases, estados, fim (C-01, C-02), escala (C-03) | F1-01, D-01, D-02 | SIM | testes de n = 1 a 5; cobertura ≥ 90% |
| F1-03 | Navmesh por mapa + validador de mapa (§8.6, §9.1) | F0-03 | IA | validador na CI |
| F1-04 | Mapa 1 (Pátio) em JSON com 3–4 layouts, 2 gaiolas, 2 saídas (§9.3) | F1-03 | IA | todas as combinações passam no validador |
| F1-05 | IA do caçador: percepção, estados, utilidade (T-03) | F1-03 | IA | 1.000 partidas sem trava; testes de cenário |
| F1-06 | Bots aliados com fuga competente (§8.5) | F1-05 | IA | mediana de perseguição ≥ 15 s |
| F1-07 | Simulador headless + relatório §7.6 como porta (Q-01) | F1-06, D-05 | QA | relatório anexado a cada PR |
| F1-08 | Pontuação completa e resumo (G-02) | F1-02 | GAM | todos os eventos pontuam e aparecem no resumo |
| F1-09 | Dificuldades da tabela 7.3 por dados (G-05, parte 1) | F1-02 | GAM | teste por dificuldade lê o valor do YAML |
| F1-10 | HUD completo (§12.1) e i18n pt-BR, en, es | F1-02 | UI | CI falha com chave faltando |
| F1-11 | Calibração interna de velocidade (C-07) | F1-07, D-03 | QA | relatório de simulação + 5 partidas do Rodrigo e do filho |

### Fase 2 — Vertical slice visual

| ID | Item | Depende de | Agente | Prova |
| --- | --- | --- | --- | --- |
| F2-01 | Material PS1: snap, afim, Gouraud, dither, intensidades (A-01) | F0-04 | RND | capturas de referência na CI |
| F2-02 | Pipeline glTF: validador, contador de triângulos e clipes | F0-02 | ART | glTF-Validator sem erros |
| F2-03 | Modelos e animação: 3 classes + Espectro (A-02) | F2-02, A1 | ART | 9 clipes por personagem; **marco A2** |
| F2-04 | Ambiente do Pátio: luz, névoa, feixes, camadas A e B | F2-01, F1-04 | RND | **marco A3** |
| F2-05 | Música adaptativa, áudio espacial, telegraph sonoro (A-03) | F1-02 | AUD | teste de compasso; LUFS na CI |
| F2-06 | Tutorial e FTUE (§12.3) | F1-10 | UI | e2e do tutorial no Playwright |
| F2-07 | Cena de pior caso e orçamentos na CI (§10.6) | F2-03, F2-04 | RND | draw calls, triângulos e download na CI; FPS em UHD 620 medido à mão |
| F2-08 | Acessibilidade de jogo: intensidades, quebra-cabeça acessível | F2-01 | UI | checklist §12.4 |

### Fase 3 — Multiplayer

| ID | Item | Depende de | Agente | Prova |
| --- | --- | --- | --- | --- |
| F3-01 | Servidor Colyseus, snapshot filtrado, predição, reconciliação, compensação (T-04) | F1-02 | NET | testes de integração com clientes reais |
| F3-02 | Caçador controlado por pessoa (C-17) | F3-01, D-09 | GAM | partida e2e com caçador humano |
| F3-03 | Filas casual e privada (código de sala), backfill com bots | F3-01 | NET | e2e com 2 navegadores |
| F3-04 | Contas convidadas, SQLite, carteira em livro-razão (E-01) | F0-05, D-07 | NET | teste de fraude de saldo |
| F3-05 | Loja no servidor com prévia (E-02, parte 1) | F3-04, D-04 | UI | compra só pelo servidor |
| F3-06 | Telemetria §15.1, `/api/metricas`, `/api/erro` | F3-01 | QA | eventos aparecem no SQLite de staging |
| F3-07 | Segurança §13.6: validação, limites, speedhack | F3-01 | NET | testes de entrada inválida; `security-review` |
| F3-08 | Teste de rede: 5 clientes, 150 ms, 5% de perda; teste de carga | F3-01..07 | QA | relatório Playwright + netem; salas por máquina |
| F3-09 | UI completa (menus, lobby, loja, perfil, configurações) (U-01) | F3-05 | UI | axe-core sem violações; **marco A4** |
| F3-10 | Gamepad e remapeamento | F3-09 | UI | navegação só por gamepad |

### Fase 4 — Conteúdo

| ID | Item | Depende de | Agente | Prova |
| --- | --- | --- | --- | --- |
| F4-01 | Mapa 2: Floresta Nebulosa (névoa que esconde quem não corre) | F1-04 | IA + ART | validador; **marco A5** |
| F4-02 | Mapa 3: Parque de Diversões, com carrossel em ciclo de 30 s (navmesh com obstáculo dinâmico; validador testa os dois estados) | F1-04 | IA + ART | validador nos dois estados; **marco A5** |
| F4-03 | Batedor (G-04) | F1-02 | GAM | uso 20–35% no simulador |
| F4-04 | Protetor (G-04) | F1-02 | GAM | uso 20–35% no simulador |
| F4-05 | Caçador 2: O Carcereiro | F1-05 | GAM + IA | contra-jogo do §4.2 testado |
| F4-06 | Caçador 3: O Lamento | F1-05 | GAM + IA | contra-jogo do §4.2 testado |
| F4-07 | Ranked: Glicko-2 por papel, tiers, temporadas (§7.5) | F3-04 | NET | teste contra os exemplos do artigo de Glickman |
| F4-08 | 5 quebra-cabeças novos com versão acessível (G-03) | F1-02 | GAM | cada um com modo acessível |
| F4-09 | XP de conta e de classe, árvore de melhorias, missões, conquistas (§5.3, §14.1) | F3-04 | GAM | tetos de 50% e 150% testados |
| F4-10 | Estado Ferido, anti-tunnel, carregar abatido (G-06) | F1-05 | GAM | regras §3.2 e §4.3 em teste |

### Fase 5 — Beta

| ID | Item | Depende de | Agente | Prova |
| --- | --- | --- | --- | --- |
| F5-01 | Playtests de 20, 50 e 200 jogadores (§15.4) | F4 | QA + Rodrigo | questionário + telemetria |
| F5-02 | Calibração com dados humanos; ajuste da porta do simulador | F5-01 | QA | métricas §7.6 com dados reais |
| F5-03 | Otimização e medição em UHD 620 | F5-01 | RND | relatório de FPS |
| F5-04 | 3 paletas do modo daltônico | F2-01 | ART | `palette-check` passa nas 3 |
| F5-05 | Soak test de 1 h, compatibilidade em 4 navegadores | F3-08 | QA | relatório |
| F5-06 | Revisão jurídica: aviso de privacidade, consentimento de menores | — | Rodrigo | parecer registrado |

### Fase 6 — Soft launch

| ID | Item | Depende de | Agente | Prova |
| --- | --- | --- | --- | --- |
| F6-01 | Deploy de produção da v1.0 | F5 | DEV | aprovação do Rodrigo no GitHub Environment |
| F6-02 | DDA em casual, modo personalizado, desafio diário (§7.4, §14.4) | F1-09 | GAM | testes por modo |
| F6-03 | Temporada 1, changelog público | F6-01 | PRO | publicação |
| F6-04 | Moeda premium e passe atrás de flag desligada (D-08) | F3-05 | NET | flag desligada em produção |

## 3. Caminho crítico e paralelismo

```mermaid
flowchart LR
  A[F0-01 monorepo] --> B[F0-03 dados] --> C[F0-04 porte] --> D[F1-01 simulação] --> E[F1-02 regras]
  E --> F[F3-01 servidor] --> G[F3-04 contas] --> H[F3-08 teste de rede] --> I[F4-07 ranked] --> J[F5-01 beta] --> K[F6-01 produção]
  B --> L[F1-03 navmesh] --> M[F1-05 IA] --> N[F1-06 bots] --> O[F1-07 simulador]
  C --> P[F2-01 shader PS1] --> Q[F2-04 ambiente]
  R[F2-02 pipeline glTF] --> S[F2-03 modelos] --> Q
  E --> T[F2-05 áudio]
  classDef crit fill:#FFB531,stroke:#101019,color:#101019
  class A,B,C,D,E,F,G,H,I,J,K crit
```

O caminho crítico (em destaque) passa pelo porte do protótipo, pelas regras e pelo multiplayer, e termina no beta com pessoas. Depois de F1-02, três frentes andam em paralelo: IA e simulador (IA, QA), visual e áudio (RND, ART, AUD) e rede (NET). A arte começa logo após a aprovação do marco A1, sem esperar a fase 1.

## 4. Orçamento mensal

Preços de [docs.fly.io/about/pricing](https://docs.fly.io/about/pricing), consultados em 08/11/2026. Detalhe no GDD-v0.3 §13.5.

| Ambiente | Componente | US$/mês |
| --- | --- | --- |
| Produção | shared-cpu-1x 512 MB (dorme sem uso) | até 3,69 + diferença de gru (LACUNA) |
| Produção | volume de 1 GB | 0,15 |
| Produção | saída de dados, ~1.000 partidas | ~1,70 |
| Staging | shared-cpu-1x 256 MB (dorme quase sempre) | ~0,50 |
| Staging | volume de 1 GB | 0,15 |
| — | GitHub Actions (repositório público) | 0 |
| **Total** | | **~6 a 8** |

Fora do teto e, por isso, fora da v1.0 sem decisão do Rodrigo: Postgres gerenciado, Redis, CDN, Sentry pago, segunda região, IPv4 dedicado. O que muda a conta: o preço de gru e o número de partidas. Alerta: se a fatura de um mês passar de US$ 8, o agente DEV abre uma issue com o detalhamento.

## 5. Portões humanos

| Portão | Quem | Onde fica registrado |
| --- | --- | --- |
| Aprovação deste plano e do GDD v0.3 | Rodrigo | comentário no PR destes documentos |
| Merge em `main` | agente, depois de testes e CI verdes (regra do Rodrigo, 08/11/2026) | PR com CI verde e revisão de outro agente |
| Deploy em produção | Rodrigo | GitHub Environment `producao` com revisor obrigatório |
| Marcos de arte A1 a A5 (Art Bible §9) | filho | comentário na issue do marco |
| Login no Fly.io e criação do token de deploy | Rodrigo | link de login enviado pelo agente DEV; o agente nunca vê a senha |
| Playtests e recrutamento do beta | Rodrigo | issue por rodada |

O Rodrigo continua aprovando o deploy em produção e acompanha os merges pelos PRs.

## 6. Agentes

**Inventário (Etapa A).** O repositório `cacada-sombria-V2` não tem pasta `.claude/`; não há agentes de jogo para reaproveitar. Do Caçada Sombria se reaproveita código e processo (CI, `fly.toml`, Dockerfile, build com hash, SQLite, snapshot filtrado, PRNG, predição, telemetria, créditos CC0). Skills já disponíveis na sessão e que os agentes vão usar em vez de recriar: `code-review`, `security-review`, `simplify`, `run`, `design:accessibility-review`, `engineering:testing-strategy`, `engineering:deploy-checklist`, `engineering:incident-response`.

**A criar após a aprovação (F0-06):**

| Sigla | Agente | Escopo | Critério de saída de cada tarefa |
| --- | --- | --- | --- |
| PRO | Produtor/orquestrador | issues, ordem do caminho crítico, resumo de fase, decisões pendentes | resumo de 1 página por fase |
| SIM | Simulação | `packages/sim`, `data/` schema, determinismo | determinismo em 100 execuções; cobertura ≥ 90% |
| GAM | Gameplay | classes, caçadores, quebra-cabeças, pontuação, progressão | teste de regra por mecânica |
| IA | IA e navegação | percepção, árvore de comportamento, bots, navmesh, validador de mapa | 1.000 partidas sem trava |
| NET | Rede e servidor | Colyseus, predição, contas, carteira, ranked, segurança | teste de integração e netem |
| RND | Render | shader PS1, cena, desempenho | orçamentos na CI |
| ART | Arte técnica | glTF, atlas, paleta, silhuetas | glTF-Validator; `palette-check` |
| AUD | Áudio | música adaptativa, espacial, mixagem, créditos | LUFS na CI; créditos completos |
| UI | UI/UX e acessibilidade | HUD, menus, i18n, gamepad | axe-core sem violações |
| QA | QA e balanceamento | simulador, relatórios §7.6, e2e, playtests | relatório anexado ao PR |
| DEV | DevOps e release | CI, Fly, versões, rollback, custos | pipeline verde; runbook testado |

Revisão cruzada: o PR de um agente é revisado por outro (ex.: SIM revisa GAM; NET revisa SIM; QA revisa todos os testes).

## 7. Decisões

Tomadas em 08/11/2026 pelo Rodrigo e pelo filho, na [página de decisões](https://claude.ai/artifact/X4o2TFZ2NGDiRS4nCPScQg). Efeito nos documentos: GDD v0.3 (revisão 2), Art Bible (revisão 2) e `data/balance.yaml` 0.3.1.

| ID | Escolha | Efeito |
| --- | --- | --- |
| A1-1 | b) mudar formas | Atacador com corpo como o do Mecânico e espada nas costas; Protetor com escudo no braço (Art Bible §3) |
| A1-2 | b) mudar cor | Atacador em vermelho (#E64242), testado contra daltonismo e contraste; demais cores mantidas |
| A1-3 | a) magenta | feixe do gerador bônus em magenta |
| A1-4 | b) sem desenhos | a folha de silhuetas é a referência principal |
| D-01 | b) basta 1 escapar | `match.team_min_escapes: 1` |
| D-02 | a) 10 min | `match.hard_time_limit: 600` |
| D-03 | b) 4,3 m/s já | perseguição Normal 4,3; tabela de dificuldade escalada (3,9 / 4,3 / 4,6 / 5,0) |
| D-04 | b) 1 por ponto, skins mais caras | skins de 640 a 2.000 (8× o protótipo) |
| D-05 | a) porta de regressão | simulador alerta piora; vira porta de banda após o beta |
| D-06 | c) Floresta e Parque | F4-01 e F4-02; Hospital para a temporada 1 |
| D-07 | a) convidado com código | sem cadastro externo na v1.0 |
| D-08 | a) fora da v1.0 | moeda premium e passe atrás de flag desligada |
| D-09 | a) caçador humano e 3 caçadores | F3-02, F4-05, F4-06 |
| D-10 | resolvida | protótipo em `prototype/the-hell.html` |
| D-11 | a) Rodrigo aprova cada mudança, **depois substituída** pela instrução do Rodrigo em 08/11/2026: os agentes fazem merge após testes e CI verdes | seção 5 |
| D-12 | a) manter público | CI gratuita no GitHub Actions |
| D-13 | a) modo opcional "Retro FPS" (Rodrigo, 08/11/2026) | 1ª pessoa com a ferramenta da classe na mão, barra de estado inferior e preset de paleta industrial; 3ª pessoa continua padrão; sem armas, sem gore, sem assets ou elementos de jogos comerciais (estilo do gênero, arte própria). Item V9 em `docs/handoff/plano-fases-1-2.md` |
| D-14 | a) mockup antes de construir (Rodrigo, 08/11/2026) | mini marco de arte A2b: capturas das ferramentas na mão e da barra de estado + até 4 perguntas ao filho em issue; construção só depois da aprovação |
| D-15 | c) variante industrial do Pátio (Rodrigo, 08/11/2026) | catálogo de mapas da v1.0 inalterado (D-06); o visual industrial é variante de texturas e iluminação do Pátio, sem layout novo |
| D-16 | a) meta pela vitória do caçador por partida (Rodrigo, 09/11/2026) | com D-01 b, a banda de 45–55% do GDD-v0.2 §7.6 vale para a vitória do caçador; a fuga por sobrevivente fica livre e é só medida (R8) |
| D-17 | a) anunciar o MJ-A ao fechar o A2 (Rodrigo, 09/11/2026) | o A2 fecha com o cajado de mago variante (a), sem caduceu (escolha do aprovador, issue #24) |
| D-18 | b) contorno sutil no caçador (Rodrigo, 09/11/2026) | legibilidade do caçador fora da lanterna (1,43:1 contra 3:1 da Art Bible §5.3) resolvida com contorno/borda de luz discreto, sem clarear a cena; entra na preparação do marco A3 |
| D-19 | a) produção só no MJ-B (Rodrigo, 09/11/2026) | o MJ-A fica no staging; o deploy de produção acontece quando as regras v1 entrarem (MJ-B), com pedido explícito do Rodrigo |
| D-20 | b) bônus de vitória para todos os vivos do time vencedor (Rodrigo, 09/11/2026) | mantém o comportamento do R1 (`endV1` em `packages/sim/src/game.ts`); diverge da leitura literal do GDD v0.3 §3.3 item 1; fica atrás de flag em `economy.win_coins_to` (pendente: entra com o R6) |
| D-21 | b) revelação do gerador completo ao caçador em qualquer ponto do mapa (Rodrigo, 09/11/2026; corrigiu a resposta inicial a) | `generator.completed_reveal_global: true` |
| D-22 | a) 5º gerador para equipes de 4–5 no ruleset v1 (Rodrigo, 09/11/2026) | pendente: item R7-mapas da Frente R (`docs/handoff/plano-frente-r.md`), sem mudar o layout 0 |
| D-23 | b) 2–3 pilares para loops curtos de 8–12 m no ruleset v1 (Rodrigo, 09/11/2026) | pendente: R7-mapas; pilares como caixas em `walls` do layout resolvido; validador passa a exigir loop curto |
| D-24 | a) 25 m só entre geradores obrigatórios (Rodrigo, 09/11/2026) | já implementado no validador do R2 |
| D-25 | b) segunda saída na parede lateral (Rodrigo, 09/11/2026) | pendente: R7-mapas: `exit_x` no mapa e em `crossedExit` |
| D-26 | a) stem "rescue" enquanto houver sobrevivente na gaiola (decidido pela supervisão por delegação do Rodrigo, 09/11/2026) | janela de decisão do resgate (GDD-v0.2 §3.2/§4.3); prioridade pressão final > perseguição > resgate > tensão > ambiente (`audio/musicState.ts`); medir em simulação: se o resgate passar de ~40% do tempo de partida, revisar |
| D-27 | a) jogador escapado ou morto perde tensão e perseguição (decidido pela supervisão por delegação do Rodrigo, 09/11/2026) | pressão final e resgate continuam valendo; ele acompanha o time como espectador (`audio/musicState.ts`) |
| D-28 | a) volume inicial 1,0 em todos os barramentos (decidido pela supervisão por delegação do Rodrigo, 09/11/2026) | mixagem masterizada a −16 LUFS (GDD-v0.3 §11); o jogador ajusta nos sliders (`data/balance.yaml` `audio.buses`) |
| D-29 | gravação do volume com atraso de 0,25 s e rampa de 0,02 s (decidido pela supervisão por delegação do Rodrigo, 09/11/2026) | `audio.volume_persist_delay` e `audio.volume_ramp_tc` em `data/balance.yaml` |
| D-32 | produção antes do previsto, no MJ-B técnico completo (decisão do Rodrigo, 09/11/2026; substitui a D-19) | só a supervisão publica (workflow `Deploy produção`); gatilho: `ruleset: v1`, `hunter_brain: utility` e `bot_brain: competent` (se o R4 passou na prova) em `main`, `pnpm sim:check` ativo e verde na CI, 1.000 partidas por dificuldade sem trava, smoke verde contra o staging |
| D-33 | ganchos de depuração do cliente só com ?debug=1 (decidido pela supervisão por delegação do Rodrigo, 09/11/2026) | `window.__thehell*` (`__thehell`, `__thehellRender`, `__thehellCharactersReady`, `__thehellAudio`, `__thehellView`) só existem com `?debug=1` (`packages/client/src/debug-hooks.ts`); as ferramentas de teste e captura abrem a página com o parâmetro; `tools/smoke.mjs` prova a ausência sem ele. Pré-requisito de qualquer publicação em produção |
| D-34 | modo tutorial na simulação exposto em dados (decidido pela supervisão por delegação do Rodrigo, 09/11/2026) | caçador passivo e etapas do GDD v0.3 §12.3 em `data/balance.yaml` seção `tutorial`; item da Frente R depois do MJ-B; UI e roteiro com a sessão Visual (V6) |
| D-30 | a) ligar os 7 eventos de pontos do sobrevivente do GDD v0.2 §7.1 (decidido pela supervisão por delegação do Rodrigo, 09/11/2026) | `points.events.{rescue, heal, block_bolt, stun, chase_escape, trap_disarm, escape}.enabled: true` com os valores do §7.1 (R6); acompanhamento: depois do R4, medir moedas por partida em Normal no R8; se a skin mais barata sair em menos de 2 partidas, propor ajuste de preço à supervisão |
| D-31 | a) pontos do caçador desligados até o caçador humano da fase 3 (decidido pela supervisão por delegação do Rodrigo, 09/11/2026) | `points.events.hunter_*` com os valores do §7.1 e `enabled: false` (D-09) |
| D-36 | teste do áudio prova o telegraph no mesmo passo em que o windup aparece, com o kind certo; a garantia ≥ telegraph_min é teste da simulação (Frente R) (decidido pela supervisão por delegação do Rodrigo, 09/11/2026) | `packages/client/test/audio-telegraph.test.ts` (sem critério numérico de antecedência; `tools/audio/telegraph.ts` imprime a antecedência só como informação: 0,383 s = telegraph_min − 1 passo com `hunter_brain: utility`). D-26 medida (`tools/audio/music-states.ts`, 50 partidas por dificuldade, ruleset v1): rescue entre 0,3% (utility) e 3,4% (basic) do tempo, em partidas só de bots; reavaliar no beta |
| D-37 | `audio.director.hunter_audible_radius` = 30 m (decidido pela supervisão por delegação do Rodrigo, 09/11/2026) | além do raio, medido do personagem visto, passos e telegraphs do caçador não tocam, para o som não virar bússola (GDD-v0.3 §11, "sem enviar a posição do caçador"); logo além da camada de tensão (`audio.music.tension_radius` 25 m, GDD-v0.3 §11) e cobre todo alcance de telegraph (`hunter.dash.max` 11 m, `hunter.projectile.max` 16 m) |
| D-38 | limiar interno `render.legibility.body_keep` 0,89 para o caçador com contorno; a Art Bible §5.3 (3:1) tem precedência sobre a métrica interna (decidido pela supervisão por delegação do Rodrigo, 09/11/2026) | complementa a D-18: em `tools/visual/compare.mjs` o corpo do caçador conserva ≥ 0,89 do contraste sem a camada A, com e sem o contorno; nenhum ponto potência × amount do contorno dá 3:1 e 0,9 juntos (PR #34); padrão `hunter_outline` power 1, amount 1,15 (3,21:1, 0,897) |
| D-39 | `audio.captions.enabled_default` = true: legendas de som ligadas por padrão (decidido pela supervisão por delegação do Rodrigo, 09/11/2026) | quem não ouve perderia o telegraph do caçador antes de achar a opção, e o GDD-v0.3 §12.4 pede legendas de sons (GDD-v0.3 §11, L218: ícone direcional); o jogador desliga em Opções (`setCaptionsEnabled`, localStorage) |
| D-40 | `audio.captions.durations` = [3, 5, 8] s, padrão 3 s (`default_duration_index: 0`) (decidido pela supervisão por delegação do Rodrigo, 09/11/2026) | duração da legenda na tela ajustável no menu (`setCaptionDuration`, só valores da lista, gravada no localStorage) |
| D-41 | diretor de áudio ligado (`audio.director_enabled: true`) no PR de ligação, commit separado e revertível (decidido pela supervisão por delegação do Rodrigo, 09/11/2026) | V5 fecha pelo critério do plano-audio-v5 §5; mudo em M até os sliders do V8 |
| D-42 | `packages/server/**`, `Dockerfile`, `fly*.toml` e `tools/smoke.mjs` ficam com a supervisão; outras sessões abrem PR pequeno e aditivo e pedem revisão dela (decidido pela supervisão por delegação do Rodrigo, 09/11/2026) | lacuna de propriedade apontada no PR #46 (V7); o servidor hoje só serve o cliente estático e `/healthz`, e o deploy de produção é da supervisão |

## 8. Riscos principais

| Risco | Efeito no plano | Mitigação |
| --- | --- | --- |
| Bots não representam humanos (lição do Caçada Sombria) | simulador não calibra; fase 4 travada | D-05; fuga competente dos bots (§8.5); calibração no beta |
| Parque de Diversões é o mapa mais caro (obstáculo móvel, D-06) | fase 4 atrasa | carrossel isolado num componente próprio; validador nos dois estados desde o primeiro layout |
| Preço de gru acima do esperado | teto de US$ 10 apertado | máquina dorme sem uso; staging em 256 MB; alerta a US$ 8 |
| Falta de jogadores no beta | critério D1 > 30% não medível | bots em casual; salas privadas; recrutamento pelo Rodrigo |
| Medição em UHD 620 | critério de FPS sem prova | máquina de um testador nas fases 2 e 5 |
| Aprovações humanas acumulam | fases param | merges feitos pelos agentes após CI verde; resumo semanal de pendências pelo PRO |

## Fontes

[GDD v0.2](GDD-v0.2.md), [GDD v0.3](GDD-v0.3.md), [Art Bible](art-bible.md), repositório `rodaquino-OMNI/cacada-sombria-V2` (commit `486320e`), [preços do Fly.io](https://docs.fly.io/about/pricing) (08/11/2026).
