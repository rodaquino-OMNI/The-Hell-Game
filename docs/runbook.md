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

## Custos

Preços de [docs.fly.io/about/pricing](https://docs.fly.io/about/pricing) (consulta em 08/11/2026): shared-cpu-1x 256 MB a US$ 2,19/mês se ficar ligada o mês todo; as duas máquinas dormem sem uso (`auto_stop_machines = "stop"`, `min_machines_running = 0`), então o custo real tende a centavos até haver jogadores. Teto do projeto: US$ 10/mês; alerta em US$ 8 (o agente DEV abre issue).

Conferir o uso: painel do Fly.io → *Billing*.

## Histórico de produção

| Data | Versão | Como | Aprovação | Verificação |
| --- | --- | --- | --- | --- |
| 08/11/2026 | `c2b08ff` (fase 0) | pela sessão, `--depot=false` | Rodrigo, na conversa ("publish it from here") | `/healthz` ok; `tools/smoke.mjs` contra https://the-hell.fly.dev ok |

## Pendências

- **Segredo `FLY_API_TOKEN` no GitHub** (o Rodrigo cria; o agente não vê o valor): no Fly.io, *Tokens* da organização pessoal → criar token de deploy; no GitHub, *Settings* → *Secrets and variables* → *Actions* → *New repository secret* → nome `FLY_API_TOKEN`. Enquanto não existir, o deploy de staging é feito pela sessão.

