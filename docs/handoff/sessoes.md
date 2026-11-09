# THE HELL — Divisão do trabalho em 3 sessões

**09/11/2026 · decisão do Rodrigo · supervisão: sessão de planejamento (a que criou as três)**

A partir de `main` em `cead60e`, as fases 1 e 2 seguem em **três sessões paralelas**, cada uma com seu contêiner e seu orquestrador. Motivo: a sessão única chegou a 69% do contexto e os agentes, no mesmo contêiner de 4 núcleos, causaram falhas de tempo em testes (relatório do orquestrador visual, 09/11/2026).

| Sessão | Plano que executa | Itens |
| --- | --- | --- |
| **Visual** (orquestrador original) | [`plano-fases-1-2.md`](plano-fases-1-2.md) | marcos de arte A2, A2b, A3; V6 tutorial, V7 desempenho, V8 acessibilidade, V9 Retro FPS; resumo do MJ-A |
| **Frente R** | [`plano-frente-r.md`](plano-frente-r.md) | R4 bots, R5 simulador na CI, R6 pontuação e dificuldades, troca para `ruleset: v1` (MJ-B), R8 calibração |
| **Áudio** | [`plano-audio-v5.md`](plano-audio-v5.md) | V5 áudio adaptativo, espacial e mixagem |

## 1. Propriedade de arquivos

Cada sessão só altera o que é seu. Fora disso, pede à dona por mensagem entre sessões (`send_message` do Claude Code Remote) ou abre PR pequeno e chama a dona para revisar.

| Caminho | Dona |
| --- | --- |
| `packages/sim/**`, `tools/sim/**`, `tools/maps/**`, `data/maps/**`, `data/sim/**` | Frente R |
| `packages/client/src/audio/**`, `packages/client/public/audio/**`, `tools/audio/**` | Áudio |
| `packages/client/src/render/**`, `hud/**`, `ui/**`, `assets/**`, `input.ts`, `loop.ts`, `main.ts`, `look.ts`, `packages/client/public/models/**`, `data/art/**`, `tools/visual/**`, `tools/assets/**`, `tools/a11y/**`, `tools/art/**` | Visual |
| `packages/client/src/i18n/**` | Visual; as outras sessões só **acrescentam** chaves em namespace próprio (`score.*`, `difficulty.*`, `audio.*`, `caption.*`) e rodam `pnpm i18n:check` |
| `data/balance.yaml` | por seção: `ai`, `nav`, `maps`, `match`, `points`, `economy`, `difficulty_table` e valores de regra → Frente R; `audio` → Áudio; `render`, `ui`, `client` → Visual |
| `packages/shared/src/schema.ts` | quem acrescenta a seção; nunca reescrever seção alheia |
| `.github/workflows/**` | cada sessão acrescenta só o próprio passo ou job; o Dependabot (PRs de ações e npm) fica com a sessão Visual |
| `packages/client/public/media/creditos.csv` | todas acrescentam linhas; nunca removem linha alheia |

## 2. Pontos de contato conhecidos

| Contato | Quem faz | Como |
| --- | --- | --- |
| Tela de fim com categorias de pontos e escolha de dificuldade (R6) | Frente R | arquivos novos `packages/client/src/ui/results.ts` e `ui/difficulty.ts` + ligação mínima em `main.ts`; avisar a Visual antes do PR e pedir revisão do agente `ui-ux` dela |
| Eventos de som que o áudio precisa da simulação (telegraph, passos por superfície, perseguição) | Áudio pede; Frente R decide | mudança aditiva em `GameEvent` (`packages/sim/src/types.ts`), revisada pelo agente `simulacao` da Frente R; suíte de paridade intacta |
| Sliders de volume e legendas de som (GDD v0.3 §11, §12.4) | Áudio expõe a API; Visual desenha | Áudio publica `setBusVolume()`, persistência e um barramento de legendas; Visual liga no menu de opções e no HUD (junto do V8) |
| Troca para `ruleset: v1` (MJ-B) | Frente R | PR próprio; a Visual confere o jogo no staging; o anúncio do MJ-B ao Rodrigo espera o marco de arte A3 |

## 3. Regras de convivência

1. Antes de cada merge: atualizar o branch com `main`, rodar `pnpm lint && pnpm typecheck && pnpm test` e esperar a CI verde no commit atual.
2. Conflito em arquivo compartilhado: quem chega depois resolve, preservando as duas mudanças; nunca force-push em branch alheio.
3. Um merge em `main` por vez dispara o deploy de staging; não cancelar runs de `main` (a CI já não cancela).
4. Toda sessão segue as regras invioláveis do `plano-fases-1-2.md` §3.
5. **Merge:** só a sessão dona de um PR faz o merge dele, depois da aprovação do agente revisor **e** da CI verde no commit atual. Ninguém liga o auto-merge do GitHub: as três sessões usam a mesma conta, então uma revisão pedindo mudanças não bloqueia o merge automático. Decisão do Rodrigo (09/11/2026): **só a supervisão e os orquestradores fazem merge**; ele não mergeia mais manualmente. Se um PR entrar com revisão pendente por qualquer motivo, a sessão dona aplica as correções num PR de acompanhamento (caso do #30).
6. **Relato à supervisão:** a cada marco ou bloqueio, cada orquestrador manda à sessão de planejamento (`send_message` com `session_id: "@parent"`) um resumo curto: o que entrou (PRs), métricas, bloqueios e perguntas ao Rodrigo. Perguntas ao Rodrigo continuam sendo feitas na própria sessão, em múltipla escolha.
