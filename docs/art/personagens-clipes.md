# Personagens: origem, clipes e orçamento (V2, F2-02)

**08/11/2026 · fonte das regras: Art Bible §3 e §7; GDD v0.3 §10.3; `data/balance.yaml` §14 `render.models` e `render.anim_fps`**

## Origem (licença conferida na página em 08/11/2026)

| Item | Valor |
| --- | --- |
| Pacote | Quaternius, *Universal Animation Library* [Standard], 43 clipes, esqueleto humanoide de 65 ossos |
| Página | https://quaternius.itch.io/universal-animation-library ("Free to use in personal, educational and commercial projects. (CC0 License)"; campo *Asset license*: Creative Commons Zero v1.0 Universal) e https://quaternius.com/packs/universalanimationlibrary.html ("License CC0") |
| Licença | CC0 1.0, https://creativecommons.org/publicdomain/zero/1.0/ (também em `License.txt` dentro do zip) |
| Arquivo baixado | `Universal Animation Library[Standard].zip`, 15.904.933 bytes, sha256 `cc73fc4e495b82958207316596317a3f40b9fa38065bde1027937452da537724` (não versionado) |
| Usados do zip | `Unreal-Godot/UAL1_Standard.glb` (esqueleto e clipes) e `Unreal-Godot/UAL1_Standard_RM.glb` (só para medir a velocidade de deslocamento de cada clipe pelo *root motion*) |
| Malha original | descartada (5.732 + 8.012 triângulos, fora do orçamento); corpo e formas-chave são peças procedurais |

Regenerar: `pnpm exec tsx tools/assets/build-characters.ts "<pasta Unreal-Godot do zip>"`. Validar: `node tools/assets/validate.mjs` (CI, depois do build).

## Como o personagem é montado

- Fichas em `packages/client/src/assets/characters.ts`: altura, proporção (braços e dedos do Espectro), peças e receita dos clipes. Cores só por token de `data/art/palette.json`.
- `packages/client/src/render/characters/bake.ts`: escala o esqueleto para a altura da ficha, alonga ossos (translações de repouso e chaves), gera as peças low-poly (`geometry.ts`) presas a um único osso cada (skin rígido, como no PS1), monta um atlas de 64×64 (`render.models.atlas`) com um bloco por token e amostra cada clipe a `render.anim_fps` com interpolação `STEP`.
- No jogo (`runtime.ts`), o mixer só avança em múltiplos de 1/`anim_fps` do relógio da simulação; a velocidade de locomoção do clipe acompanha a velocidade medida do ator (sem pé escorregando).

## Clipes (9 por personagem, Art Bible §7)

| Clipe | Fonte no pacote | Sobreviventes | Espectro | Derivado? | Ativo no jogo hoje (estado do sim) |
| --- | --- | --- | --- | --- | --- |
| `idle` | `Idle_Loop` | direto | direto | não | parado |
| `andar` | `Jog_Fwd_Loop` | direto (o passo do protótipo, 4 m/s, é de trote) | direto | não | velocidade > 0 e ≤ média de `walk`/`run` (caçador: `patrol_speed`/perseguição) |
| `correr` | `Sprint_Loop` | direto | direto | não | velocidade acima da média |
| `interagir` | `Fixing_Kneeling` (sobrev.), `Interact` (caçador) | direto | direto | não | sobrevivente: quebra-cabeça aberto, resgate, bot com `work` subindo; caçador: **inativo** |
| `ferido` | `Walk_Loop` | 0,8× + tronco 18° e cabeça 12° curvados | igual | **sim** | **inativo**: falta `survivor.wounded_hp` em `balance.yaml` (GDD v0.3 §8.3 usa 40) |
| `preso` | `Crouch_Idle_Loop` | direto | direto (sem uso) | não | `st = cage` |
| `golpe` | `Punch_Cross`; Atacador `Sword_Attack` | direto | 1,2× | Espectro **sim** | caçador: começa no preparo (`hunter.windup.kind = melee`, regras v1); sem preparo, borda de subida de `atk` |
| `dash` | `Sprint_Loop` | 1,5× + tronco 14° à frente | igual | **sim** | caçador: preparo (`hunter.windup.kind = dash`) ou `dashing > 0`; sobrevivente: **inativo** |
| `atordoado` | `Hit_Head` | 0,35× em laço + cabeça tombada 10° | igual | **sim** | caçador: `stun > 0`; sobrevivente: **inativo** |

A mesma tabela, com o critério de cada estado, está em `packages/client/src/render/characters/state.ts` (`ACTIVE`).

## Orçamento (resultado de `node tools/assets/validate.mjs`)

| Personagem | Tipo | Altura | Triângulos | Orçamento (`render.models`) | Ossos | Tamanho |
| --- | --- | --- | --- | --- | --- | --- |
| Curandeiro | sobrevivente | 1,75 m | 394 | 300–600 | 25 | 208 KB |
| Mecânico | sobrevivente | 1,76 m | 392 | 300–600 | 25 | 208 KB |
| Atacador | sobrevivente | 1,76 m | 344 | 300–600 | 25 | 202 KB |
| Batedor | sobrevivente | 1,72 m | 358 | 300–600 | 25 | 202 KB |
| Protetor | sobrevivente | 1,82 m | 308 | 300–600 | 25 | 194 KB |
| Espectro | caçador | 2,50 m | 860 | 800–1.200 | 65 | 459 KB |

Batedor e Protetor ficam prontos para a fase 4; o jogo hoje usa Curandeiro, Mecânico, Atacador e Espectro.
