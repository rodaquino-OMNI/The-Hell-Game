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

Regenerar: `pnpm data && pnpm exec tsx tools/assets/build-characters.ts "<pasta Unreal-Godot do zip>"`. Validar: `node tools/assets/validate.mjs` (CI, depois do build).

## Como o personagem é montado

- Ficha em `data/art/personagens.json` (V3; schema em `packages/shared/src/art.ts`, validado por `pnpm data` junto com a paleta e as skins da economia): altura, proporção (braços e dedos do Espectro), corpo-base, peças, conjuntos de clipes, ponto do acessório de skin e as 7 skins. `packages/client/src/assets/characters.ts` só expande a ficha (corpo-base de 17 peças, dedos, herança de clipes). Cores só por token de `data/art/palette.json`; tokens de estado (`ui.accent`, `fx.*`, `ui.danger`) são proibidos no corpo.
- `packages/client/src/render/characters/bake.ts`: escala o esqueleto para a altura da ficha, alonga ossos (translações de repouso e chaves), gera as peças low-poly (`geometry.ts`) presas a um único osso cada (skin rígido, como no PS1), monta um atlas de 64×64 (`render.models.atlas`) com um bloco por token e amostra cada clipe a `render.anim_fps` com interpolação `STEP`.
- No jogo (`runtime.ts`), o mixer só avança em múltiplos de 1/`anim_fps` do relógio da simulação; a velocidade de locomoção do clipe acompanha a velocidade medida do ator (sem pé escorregando).

## Clipes (9 por personagem, Art Bible §7)

| Clipe | Fonte no pacote | Sobreviventes | Espectro | Derivado? | Ativo no jogo hoje (estado do sim) |
| --- | --- | --- | --- | --- | --- |
| `idle` | `Idle_Loop` | direto | direto | não | parado |
| `andar` | `Jog_Fwd_Loop` | direto (o passo do protótipo, 4 m/s, é de trote) | direto | não | velocidade > 0 e ≤ média de `walk`/`run` (caçador: `patrol_speed`/perseguição) |
| `correr` | `Sprint_Loop` | direto | direto | não | velocidade acima da média |
| `interagir` | `Fixing_Kneeling` (sobrev.), `Interact` (caçador) | direto | direto | não | sobrevivente: quebra-cabeça aberto, resgate, bot com `work` subindo; caçador: **inativo** |
| `ferido` | `Walk_Loop` | 0,8× + tronco 18° e cabeça 12° curvados | igual | **sim** | sobrevivente andando com vida abaixo de `survivor.wounded_hp` (40, GDD v0.3 §8.3); caçador: **inativo** |
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

## Ajustes de legibilidade do V3 (F2-03)

Achados da revisão do V2 (risco no teste de silhueta a 384×216). Formas-chave e cores dominantes aprovadas no marco A1 não mudaram; só espessura, tamanho e ângulo de acessórios, e cores secundárias passaram a ter token próprio. Triângulos iguais aos do V2 (nenhuma peça nova).

| Personagem | Peça | Antes | Depois |
| --- | --- | --- | --- |
| Curandeiro | cajado | raio 0,028, `ui.text_dim` | raio 0,07 (2,5×), `char.madeira` |
| Curandeiro | caduceu (losango) | raio 0,08, ponta a 1,64 | raio 0,12, ponta a 1,70 |
| Curandeiro | caduceu (asas) | 0,06 × 0,04 × 0,36, `ui.text` | 0,10 × 0,09 × 0,44, `char.lamina` |
| Curandeiro | manto | topo 0,17 × 0,13, giro 30° (arestas do tronco atravessavam) | topo 0,20 × 0,15, base 0,32 × 0,27, giro 45° (igual ao tronco) |
| Mecânico | lanterna | `ui.accent` (= `fx.preso`) | `char.lanterna` (branco-azulado) |
| Mecânico | chave inglesa | `ui.text_dim` | `char.metal` |
| Atacador | lâmina | espessura 0,012, largura 0,05, `ui.text` | espessura 0,03 (2,5×), largura 0,06, `char.lamina` |
| Atacador | guarda | 0,20 × 0,04 × 0,05, `ui.panel` | 0,28 × 0,09 × 0,10, `char.couro` |
| Atacador | cabo | raio 0,025 | raio 0,06 (2,4×) |
| Batedor | cachecol (volta) | raio 0,085, `ui.accent` | raio 0,10, `char.cachecol` (azul) |
| Batedor | cachecol (pontas) | 0,10 × 0,05 × 0,40 e 0,09 × 0,05 × 0,34, quase paralelas | 0,17 × 0,10 × 0,52 e 0,16 × 0,10 × 0,46, abertas 22° e 24° para os lados |
| Protetor | escudo | face para fora (+Y na pose T), raio 0,30: de frente virava uma linha | eixo girado 40° para a frente, raio 0,33 |
| Protetor | bossa | `ui.text_dim` | `char.metal`, no eixo girado |
| Espectro | braços (`bracos`) | 1,6 (mãos na altura do joelho) | 2,15 (mãos passam do joelho no idle) |
| Espectro | farrapos e pés | `ui.panel` | `hunter.farrapos` |
| Sobreviventes | pele, calça, sapato | `ui.text`, `world.wall`, `ui.bg` | `char.pele`, `char.calca`, `char.sapato` (as duas últimas trocadas pela skin) |

Skins (GDD v0.2 §10.3, Art Bible §3 e §7): trocam só `char.calca` e `char.sapato` (tokens `skin.<id>.a` e `.b`) e põem um acessório pequeno no peito (uma caixa de 12 triângulos no ponto `acessorio` da ficha, que o bake grava em `personagens.json`); o validador soma esses 12 triângulos ao orçamento do sobrevivente. Só o sobrevivente do jogador veste a skin equipada, como no protótipo.

Capturas do marco A2 e proxy de silhueta (IoU entre pares): `node tools/art/a2-capturas.mjs <pasta>` depois de `pnpm build`.

## Leitura de estado dos geradores no jogo (V3, Art Bible §4)

Implementação em `packages/client/src/render/states.ts`; números em `data/balance.yaml` `render.states`.

| Estado do sim | Feixe | Padrão |
| --- | --- | --- |
| obrigatório, `n = 0` | `gen.pendente` | pisca a `pending_hz` (1 Hz), aceso `pending_duty` (0,5) do ciclo |
| obrigatório, `n > 0` | `gen.progresso` | pulsa na largura a `progress_hz` (2 Hz), até × (1 + `progress_pulse`) |
| concluído (obrigatório ou bônus) | `gen.pronto` | contínuo |
| bônus não concluído (com ou sem progresso) | `gen.bonus` | espiral girando + losango no topo; **não pulsa** |

Escolhas registradas (a Art Bible §4 não trata os dois casos):
- **Bônus em andamento não pulsa:** o bônus já tem padrão próprio (espiral e losango); somar o pulso do "em progresso" misturaria dois sinais no mesmo feixe. O progresso do bônus aparece no quebra-cabeça e no HUD.
- **Bônus concluído vira "pronto":** para o jogador, "concluído" é um estado só (verde-água contínuo); a espiral e o losango somem. Assim "pronto" significa sempre "nada mais a fazer aqui".

Feixe sem vertex snapping (uniforme `uSnap` próprio, `beam.snap`) e com largura mínima de `beam.min_px` pixels internos: de longe ele continua uma linha cheia. Olhos do caçador no preparo: `hunter.olhos_preparo`, ≥ 3:1 contra `hunter.olhos` também no pior pixel do dither (portão em `pnpm check:palette`), mais o lampejo (`eyes_flare`): sem vertex snapping, com altura mínima de 2 pixels internos e avançado para a câmera, porque a 8 m a faixa de 7 cm sumia na grade do snap.
