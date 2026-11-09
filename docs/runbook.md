# THE HELL — runbook de operação

**Fase 0 · 08/11/2026**

| Ambiente | App no Fly.io | URL | Máquina | Deploy |
| --- | --- | --- | --- | --- |
| Staging | `the-hell-staging` | https://the-hell-staging.fly.dev | shared-cpu-1x 256 MB, gru, dorme sem uso | automático a cada merge em `main` (CI), ou manual pela sessão |
| Produção | `the-hell` | https://the-hell.fly.dev | shared-cpu-1x 256 MB, gru, dorme sem uso | só manual, com aprovação do Rodrigo |

Os dois apps ficam na organização pessoal do Rodrigo no Fly.io. Nenhum tem volume ainda (o SQLite entra na fase 3).

## Verificar se está no ar

```bash
curl -fsS https://the-hell-staging.fly.dev/healthz
```

```bash
node tools/smoke.mjs /tmp/staging.png https://the-hell-staging.fly.dev
```

`/healthz` devolve `{"ok":true,"version":"<commit>"}`. O teste de fumaça abre o jogo no Chromium, inicia uma partida e confere estado e erros.

## Deploy

**Pela CI (padrão).** Cada merge em `main` roda testes, build, fumaça e varredura de segredos; se tudo passar, o job `deploy-staging` publica em staging. Ele precisa do segredo `FLY_API_TOKEN` no repositório (ver "Pendências"). Sem o segredo, o job avisa e não falha.

**Produção.** Aba *Actions* → *Deploy produção* → *Run workflow* → digitar `PRODUCAO`. Só o Rodrigo dispara (portão humano do plano, §5).

**Pela sessão de desenvolvimento** (quando a CI não tem o token). O builder Depot usa gRPC, que o proxy da sessão bloqueia; use o builder do próprio Fly:

```bash
fly deploy --config fly.staging.toml --remote-only --depot=false --ha=false --build-arg APP_VERSION=$(git rev-parse --short HEAD)
```

## Rollback

1. Listar as versões e achar a imagem anterior:

```bash
fly releases --app the-hell-staging --image
```

2. Publicar a imagem anterior (sem rebuild):

```bash
fly deploy --config fly.staging.toml --image <imagem da versão anterior> --ha=false
```

3. Conferir `/healthz` (o campo `version` mostra o commit em produção) e rodar o teste de fumaça.

Para produção, o mesmo com `--app the-hell` e `fly.production.toml`, com aprovação do Rodrigo.

**Teste do rollback (08/11/2026, staging):**

| Passo | Versão no `/healthz` |
| --- | --- |
| v2 publicada (commit `495069a`) | `495069a` |
| rollback para a imagem da v1 | `dev` (versão anterior) |
| volta para a imagem da v2 | `495069a` |

Cada troca levou menos de 1 minuto, sem rebuild.

## Desempenho

Metas do GDD v0.3 §10.6, limiares em `data/balance.yaml` `render.budgets`.

**Na CI (automático):** `pnpm perf:budget` (`tools/perf/budget.mjs`) abre a cena de pior caso (`?stress=1`: caçador e 5 sobreviventes das 5 classes, inclusive Protetor e Batedor só como atores de render, mapa inteiro, camadas do preset, armadilhas e projéteis no máximo) em cada preset, sem e com `?retro=1`, e falha se `renderer.info` passar de `render.budgets.draw_calls` ou `triangles` em alguma vista. Também mede o download inicial (bytes transferidos até o jogo ficar jogável, rede limitada a `render.stress.network_mbps`) e o tempo até jogar. O tempo de relógio só é reportado na CI: no SwiftShader o primeiro quadro mede a CPU do runner, não a GPU do jogador; a CI falha se a transferência do download inicial na rede limitada passar de `time_to_play_s` (com `--strict-time`, o tempo de relógio também conta). Relatório `budget.json` e `budget.md` no artefato `orcamentos-desempenho` quando falha.

**Custo das camadas contra main (CI, D-49 / issue #59; critério de D-51):** o passo "Build de main para o custo das camadas" faz `git worktree add` da base em `$RUNNER_TEMP/main` e compila o cliente (no `pull_request`, `HEAD^1` = a base do PR; no push para main, `github.event.before` = o main antes do push, com volta para `HEAD^1` se for só zeros ou o fetch falhar; o log do passo imprime o SHA usado); `tools/visual/compare.mjs --baseline "$RUNNER_TEMP/main"` mede o PR e main no mesmo navegador, em rodadas intercaladas, e só reprova se o limite inferior do IC 95% da diferença relativa do ms/quadro com A+B (PR_AB / main_AB − 1, pareada por rodada) passar de `render.cost_check.main_rel_delta` (+5%); com a mediana acima e o limite inferior abaixo, só a anotação "Custo das camadas (D-49)". O log (linhas `custo × main`) e o resumo do job trazem, por vista, o ms/quadro com A+B do PR e de main com a diferença relativa e o IC (o portão) e, só para informação, o ms/quadro sem camadas, a razão A+B ÷ sem camadas dos dois builds com a diferença e o IC, e a razão do PR contra o orçamento e o teto de D-44: nada disso reprova nem vira anotação, porque a razão sobe quando o PR otimiza só a base (o denominador encolhe). Se o portão reprovar: comparar o ms/quadro com A+B dos dois builds no resumo; se o sem camadas também subiu na mesma proporção, a regressão está fora das camadas. Se não houver build de main utilizável (passo de main falhou, build ou `render.layer_a` ausentes, main sem o gancho de custo, servidor de main não subiu) ou se o lado de main lançar exceção no meio da medida, a comparação não é feita: aparece só a anotação "Custo das camadas (D-49)" com "sem build de main, comparação não feita (motivo)", com a mesma linha no resumo do job, e o passo não reprova por custo (complemento de D-49; o teto absoluto de D-44 não vale como portão). Exceção do lado do PR reprova. Para investigar: ler o motivo na anotação e o log do passo "Build de main para o custo das camadas". Reproduzir localmente (com `pnpm build` feito no PR):

1. `git worktree add --detach ../main-custo origin/main && cd ../main-custo && pnpm install --frozen-lockfile && pnpm data && pnpm --filter @thehell/client build && cd -`
2. `node tools/visual/compare.mjs --baseline ../main-custo` e ler as linhas `custo × main` (anotar a carga da máquina, que o log imprime).
3. `git worktree remove ../main-custo`.

**FPS em Intel UHD 620 (manual; LACUNA até haver máquina):** a CI não tem GPU real. Medir no fim das fases 2 e 5 numa máquina do Rodrigo ou de um testador:

1. Máquina com Intel UHD Graphics 620 (conferir em `chrome://gpu`: "GL_RENDERER" com "UHD Graphics 620"; aceleração por hardware ligada), carregador ligado, plano de energia equilibrado, outras abas e programas fechados.
2. Chrome atual, janela de 1280×720 de área útil (ou tela cheia em monitor 720p). Zoom do navegador em 100%.
3. Abrir `https://the-hell-staging.fly.dev/?debug=1&stress=1&preset=high` e clicar em "Jogar". A partida fica parada; a tela mostra a vista de cima com o mapa inteiro, os 6 personagens e todas as camadas do preset.
4. Esperar 10 s (shaders e modelos carregados). Sem `?debug=1` o gancho não existe (D-33). No console do DevTools (F12), rodar `await __thehellRender.fps(60)` sem mexer em nada: devolve quadros, segundos e FPS médio dos 60 s.
5. Repetir com `preset=medium` (padrão) e `preset=low`, e com `&retro=1` no preset padrão.
6. Registrar na issue do V7: modelo da máquina, versão do Chrome, driver, resolução e o FPS de cada execução. Meta: `render.budgets.fps` (60) no preset padrão.
7. Orçamento das camadas (`render.layer_cost_factor`, 1,4×; D-44 e D-51: na CI a razão é só informativa, o orçamento é conferido aqui): no preset padrão, rodar `__thehellRender.setLayers({ A: false, B: false, C: false })`, esperar 5 s e `await __thehellRender.fps(60)`; depois `__thehellRender.setLayers({ A: true, B: true, C: false })`, esperar 5 s e repetir. A razão é FPS sem camadas ÷ FPS com A+B; acima de `layer_cost_factor` = fora do orçamento (registrar na issue do V7). Se as duas medidas baterem no teto do monitor (vsync, ex.: 60 FPS), a razão não mede o custo: anotar "no teto do vsync", o que já cumpre o orçamento.

## Custos

Preços de [docs.fly.io/about/pricing](https://docs.fly.io/about/pricing) (consulta em 08/11/2026): shared-cpu-1x 256 MB a US$ 2,19/mês se ficar ligada o mês todo; as duas máquinas dormem sem uso (`auto_stop_machines = "stop"`, `min_machines_running = 0`), então o custo real tende a centavos até haver jogadores. Teto do projeto: US$ 10/mês; alerta em US$ 8 (o agente DEV abre issue).

Conferir o uso: painel do Fly.io → *Billing*.

## Histórico de produção

| Data | Versão | Como | Aprovação | Verificação |
| --- | --- | --- | --- | --- |
| 08/11/2026 | `c2b08ff` (fase 0) | pela sessão, `--depot=false` | Rodrigo, na conversa ("publish it from here") | `/healthz` ok; `tools/smoke.mjs` contra https://the-hell.fly.dev ok |

## Pendências

- **Segredo `FLY_API_TOKEN` no GitHub** (o Rodrigo cria; o agente não vê o valor): no Fly.io, *Tokens* da organização pessoal → criar token de deploy; no GitHub, *Settings* → *Secrets and variables* → *Actions* → *New repository secret* → nome `FLY_API_TOKEN`. Enquanto não existir, o deploy de staging é feito pela sessão.

