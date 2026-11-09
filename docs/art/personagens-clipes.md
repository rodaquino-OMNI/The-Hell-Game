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
| Curandeiro | sobrevivente | 1,75 m | 480 (variante a, padrão); 520 (variante b) | 300–600 | 25 | 222 KB |
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

## A2-ajuste: cajado de mago do Curandeiro (08/11/2026, aguardando escolha)

Pedido do aprovador do marco A2: "o cajado do Curandeiro deveria se parecer com o de um mago ancestral". Desenho próprio no estilo do gênero (não reproduz o cajado de nenhum filme, livro ou jogo): haste de madeira nodosa em 3 trechos com dobras leves e nós, amarrado de couro com ponta solta abaixo da cabeça, e 3 galhos de seção triangular que abrem e se fecham em volta de um cristal emissivo (octaedro alongado) cuja ponta passa acima dos galhos, para ler também de costas. Capuz e manto (o resto da forma-chave, Art Bible §3) não mudaram. **A Art Bible não foi alterada**: muda só depois da escolha.

As duas variantes ficam na ficha (`data/art/personagens.json`, `curandeiro.variantes`; schema em `packages/shared/src/art.ts`). As peças da variante `padrao` somam-se a `pecas` no bake; a outra é assada só para medir triângulos (manifesto `personagens.json`, campo `variantes`) e o validador confere as duas contra `render.models.survivor_tris` com o acessório de skin. Escolher = trocar `padrao` e rodar `tools/assets/build-characters.ts`, `node tools/assets/validate.mjs` e `node tools/visual/compare.mjs --update` (o Curandeiro aparece nas cenas de referência).

| Variante | Id | O que tem | Triângulos | + skin | Orçamento |
| --- | --- | --- | --- | --- | --- |
| (a), **padrão até a escolha** | `mago` | cajado de mago com cristal, sem caduceu | 480 | 492 | 300–600 |
| (b) | `mago_caduceu` | o mesmo cajado + caduceu pequeno: 2 asas (`char.lamina`) logo abaixo do amarrado e serpente em S de 2 trechos (`class.curandeiro`) cruzando a haste | 520 | 532 | 300–600 |

| Peça | Antes (V3) | Depois (a e b) |
| --- | --- | --- |
| haste | 1 cilindro reto de 4 lados, raio 0,07, de -0,75 a 1,45 (eixo da mão); no idle tombava para trás e para dentro | 3 trechos de 4 lados, raios 0,05→0,06, 0,072→0,06, 0,075→0,08 (o começo de cada trecho mais grosso que o fim do anterior faz o nó), `char.madeira`; todo o cajado girado -28° em Y e +10° em Z para ficar de pé no idle |
| topo | caduceu: losango (pirâmide, `class.curandeiro`) + asas (caixa 0,10 × 0,09 × 0,44, `char.lamina`) | 3 galhos (2 trechos de 3 lados cada, raios 0,045→0,022) em volta de um cristal emissivo (elipse de 4 lados e 2 anéis = octaedro, raios 0,18 × 0,10 × 0,10, `class.curandeiro`, `brilho`) |
| couro | — | amarrado (cilindro de 4 lados, raio 0,098) + ponta solta (caixa 0,20 × 0,035 × 0,03), `char.couro` |
| caduceu | no topo, grande | só na variante (b), pequeno, abaixo do cristal |

Cores: só tokens já aprovados (`char.madeira`, `char.couro`, `char.lamina`, `class.curandeiro`); nenhum token novo. O cristal usa a cor dominante da classe e o material emissivo dos olhos e da lanterna (chapado, sem névoa, máscara de emissivo no alfa): entra no bloom da camada A do V4. Custo: o bloom é um passe de tela cheia, independente de quantos pixels são emissivos; `node tools/visual/compare.mjs` deu razão pareada de 1,27×–1,38× com o cajado novo e 1,29×–1,37× com o cajado do V3 no mesmo build (3 rodadas cada; teto `render.layer_cost_factor` 1,4×).

Proxy de silhueta (IoU entre máscaras pretas, `tools/art/a2-capturas.mjs`, `silhuetas-iou.json`), Curandeiro contra cada um, pior vista de perto / pior vista na distância de jogo:

| Par | V3 (antes) | (a) mago | (b) mago_caduceu |
| --- | --- | --- | --- |
| × Mecânico | 0,653 / 0,579 | 0,559 / 0,652 | 0,552 / 0,637 |
| × Atacador | 0,584 / 0,571 | 0,561 / 0,642 | 0,554 / 0,628 |
| × Batedor | 0,486 / 0,403 | 0,469 / 0,415 | 0,463 / 0,407 |
| × Protetor | 0,541 / 0,540 | 0,555 / 0,589 | 0,548 / 0,578 |
| × Espectro | 0,353 / 0,288 | 0,402 / 0,274 | 0,410 / 0,272 |

De perto o Curandeiro ficou mais distinto de Mecânico, Atacador e Batedor; na distância de jogo, de lado, subiu (0,58 → 0,65 contra o Mecânico) porque a haste agora fica de pé junto do corpo em vez de cruzar o quadro na diagonal. Todos os pares do Curandeiro seguem abaixo dos pares já aprovados no A2 (Mecânico × Atacador 0,867, Atacador × Protetor 0,757). Batedor (ponta na cabeça): 0,47 de perto e 0,42 no jogo, menor que antes de perto. Proxy apenas; o portão é o teste humano da Art Bible §5.1.

Câmera em 3ª pessoa (ombro direito, o lado do cajado): `a2-capturas.mjs` grava `jogo-curandeiro-3a-pessoa-{reta,para-cima,para-baixo}.png`; o cajado fica ao lado do corpo e nunca chega perto da câmera (menor distância 2,44 m, revisão do PR #25); com a câmera reta, a haste e o cristal caem na linha vertical central da tela no `idle` e no `preso` (não há mira até a fase 3). Variante escolhida no A2: (a) `mago`, sem caduceu.

Registro do marco em `docs/art/marcos/a2/` (capturas do build com V4):

| Arquivo | Conteúdo (da esquerda para a direita) |
| --- | --- |
| `a2-elenco-frente-preto.png`, `a2-elenco-frente-cor.png` | elenco de frente com a variante (a) |
| `a2-elenco-frente-preto-variante-b.png` | elenco de frente em preto com a variante (b) |
| `a2-espectro-preparo-olhos.png` | Espectro com os olhos acesos no preparo |
| `cajado-variantes-preto.png`, `cajado-variantes-cor.png` | de frente: V3, (a), (b); de lado: V3, (a), (b) (384×216 recortado, ampliado 3×) |
| `cajado-variantes-close.png` | close: (a) frente, (b) frente, (a) lado, (b) lado |
| `cajado-variantes-jogo.png` | no jogo, 3ª pessoa: (a), (b) |

Montagem: `node tools/art/lado-a-lado.mjs <saida.png> --de 4 --largura 90 --zoom 3 <png>...` sobre as pastas de `a2-capturas.mjs` de cada variante.

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
