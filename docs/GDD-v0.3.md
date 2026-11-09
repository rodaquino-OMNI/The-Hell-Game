# THE HELL — Game Design Document v0.3

**Delta sobre o v0.2 · 08/11/2026 · revisão 2: decisões D-01 a D-12 aplicadas**

O v0.3 fecha as seções 8 a 13 (IA, mapas, gráficos, áudio, UI e arquitetura) e resolve as contradições do v0.2. Ele não repete o v0.2: toda seção não citada aqui continua valendo como está em [`GDD-v0.2.md`](GDD-v0.2.md). Onde houver conflito, vale o v0.3.

Cada item especificado aqui tem três coisas: a regra, o parâmetro em [`data/balance.yaml`](../data/balance.yaml) (caminho entre crases) e o critério de aceite que um teste ou uma pessoa verifica. A direção de arte detalhada está em [`art-bible.md`](art-bible.md).

Legenda (igual ao v0.2): **[Implementado]** · **[Especificado]** · **[Proposta]** · **[Meta]**. Novo: **Δ** marca o que mudou em relação ao v0.2; **LACUNA** marca o que não tem fonte e precisa ser verificado, nunca preenchido por suposição.

---

## Δ1. Contradições e lacunas resolvidas

| ID | Onde (v0.2) | Problema | Decisão no v0.3 | Quem confirma |
| --- | --- | --- | --- | --- |
| C-01 | §3.3 | Regra de vitória da equipe escrita duas vezes, a segunda frase interrompida ("…regra simplificada"). | **Decidido (D-01 b):** a equipe vence se **pelo menos 1** sobrevivente escapar **ou** a vida do caçador chegar a 0; senão vence o caçador (§3.3 revisto). Fecha a pendência §19.3. | Rodrigo e filho, 08/11/2026 |
| C-02 | §2.5, §3.1, §3.3 | Não há condição que encerre a partida se ninguém chegar ao portão: o protótipo acaba quando o jogador morre, e o GDD pede eliminar todos. | Partida termina quando todos os sobreviventes estão em estado terminal, ou a vida do caçador chega a 0, ou o limite duro de tempo é atingido. **Decidido (D-02 a):** limite duro de 10 min (`match.hard_time_limit`). | Rodrigo e filho, 08/11/2026 |
| C-03 | §3.5 × §7.3 | Vida do caçador escala por tamanho do time (50/65/80/90–100) e também por dificuldade (60/80/100/120), sem regra de combinação. As duas tabelas têm 80 como base (3 sobreviventes, Normal). | Vida = `hp` da dificuldade (§7.3) × fator do time. Fatores tirados do §3.5 dividindo por 80: 0,625 / 0,8125 / 1 / 1,125 / 1,25 (`hunter_hp_scale`). Exemplo: Difícil com 5 sobreviventes = 100 × 1,25 = 125. | Simulador (fase 1) |
| C-04 | §13.2 × §15.2 × Apêndice A | `data/` em JSON (§13.2) ou em YAML (§15.2, Apêndice A). | YAML é a fonte editada; o build valida por schema e gera JSON para o cliente e o servidor. | — |
| C-05 | §13.5 × stack decidida | Postgres, Redis, CDN Cloudflare, Sentry e Prometheus/Grafana estouram o teto de US$ 10/mês e a regra de hospedar só no Fly.io. | Substituição por equivalentes já em produção no Caçada Sombria: SQLite no volume do Fly, filas em memória, assets servidos pela própria máquina com cache imutável, erros e métricas em rotas próprias. Detalhe em §13.5 revisto. | Decisão já tomada |
| C-06 | §2.3 × §3.4 × §8.1 | O protótipo detecta em 360° num raio de 11 m (confirmado no código, `prototype/the-hell.html` L162); o GDD especifica cone de 90° com linha de visão. | Vale o GDD (cone de 90°, `hunter.vision_fov_deg`). Como isso enfraquece o caçador em relação ao baseline, a paridade da fase 0 mede o protótipo com 360° e a fase 1 recalibra no simulador. | Simulador (fase 1) |
| C-07 | §2.3 × §1 pilar 4 × §9.1 | O caçador persegue a 3,9 m/s e o sobrevivente **anda** a 4,0 m/s. Andando, o sobrevivente nunca é alcançado sem dash ou projétil; o "loop de 6 a 10 s de vantagem" do §9.1 deixa de ter sentido. | **Decidido (D-03 b):** perseguição de 4,3 m/s em Normal. Para manter a ordem da tabela §7.3, as outras dificuldades sobem na mesma proporção (×4,3/3,9): Fácil 3,9, Difícil 4,6, Pesadelo 5,0. Na pressão final (×1,2), o caçador chega a 5,16 m/s, ainda abaixo da corrida do sobrevivente (5,4). A paridade da fase 0 continua medida com 3,9 (valor do protótipo). | Rodrigo e filho, 08/11/2026 |
| C-08 | §2.3 × §3.4 | Falha em quebra-cabeça chama o caçador por 8 s (protótipo, de qualquer distância, L118) ou gera ruído de 18 m (§3.4). | Vale o §3.4: ruído de 18 m; o caçador só reage se estiver no raio. Mesmo tratamento da C-06 na calibração. | Simulador (fase 1) |
| C-09 | §2.3 × §7.2 × Apêndice A | Baseline converte pontos em moedas 1:1; o Apêndice A já usa 0,3 (proposta do §7.2). | **Decidido (D-04 b):** mantém 1 moeda por ponto e **aumenta o preço das skins**. As 7 skins atuais passam a custar 8× o preço do protótipo: Sombra 640, Abóbora 800, Neon Ciano 960, Carmesim 1.200, Ouro 1.600, Fantasma 2.000. Com 170 a 300 moedas por partida (20 + 30 na vitória + 150 a 250 pontos, §7.2), a skin mais barata sai em 2 a 4 partidas e a mais cara em 7 a 12; a média fica perto do ritmo do §14.2 (3 a 5). Fecha §19.4. | Rodrigo e filho, 08/11/2026 |
| C-10 | §10.1 × §10.6 | Resolução interna 320×240 (4:3) ou 384×216 (16:9); meta de FPS "a 720p". | 16:9 em todos os presets. Resolução interna por preset (320×180, 384×216, 480×270), escalada por inteiro até a saída de 1280×720 em que o FPS é medido. | — |
| C-11 | §13.3 × Apêndice B | Simulação a 60 Hz no cliente e 30 Hz no servidor quebra o determinismo da predição (passos diferentes dão resultados diferentes). | Passo da simulação fixo em 1/60 s nos dois lados. O servidor roda 2 passos por tick de 30 Hz (`net.sim_step_hz`, `net.server_tick_hz`). | — |
| C-12 | §10.1 × three.js atual | O v0.2 conta com iluminação por vértice do `MeshLambertMaterial` (r128). Nas versões atuais do three.js o Lambert é calculado por fragmento. **LACUNA:** confirmar no changelog a versão exata da mudança. | Shader próprio de Gouraud (iluminação por vértice) dentro do material PS1 (§10 revisto). | Agente de render (fase 2) |
| C-13 | §11 × navegadores | `.ogg/.opus` como formato único. Suporte a Opus no Safari não verificado (**LACUNA**). | MP3 como formato de entrega na v1.0, como no Caçada Sombria (50 arquivos MP3 em produção nos 4 navegadores). Opus volta como otimização se o suporte for confirmado. | — |
| C-14 | §9.4 × capacidade de agentes | Mapas feitos no Blender com metadados no glTF exigem edição manual em ferramenta gráfica. | Layout de mapa em JSON (`data/maps/*.json`: paredes, spawns, geradores, loops, gaiolas, esconderijos), gerado e validado por script, como no Caçada Sombria (`tools/mapgen`). glTF fica para personagens e props. | — |
| C-15 | §7.6 × experiência do Caçada Sombria | O §15.2 faz a CI falhar se o simulador sair das bandas da §7.6. No Caçada Sombria, bots deram vitória ao caçador em 84 a 100% das partidas e nenhuma alavanca testada mudou o resultado, porque a fuga dos bots é bem mais fraca que a de pessoas (`cacada-sombria-V2/docs/balanceamento-v07.md`). | **Decidido (D-05 a).** O simulador vira **porta de regressão** (falha se a métrica piorar mais que a tolerância contra o build anterior) e só vira porta de banda depois que a calibração com pessoas da fase 5 mostrar que bots e humanos dão resultados próximos. | Rodrigo, 08/11/2026 |
| C-17 | §0 × §17.1 | A v1.0 tem 3 caçadores (§0), mas a fase 4 só prevê o "caçador 2". O "Jogar de caçador" aparece como modo opcional (§14.4), embora o multiplayer 1 contra 5 exija um caçador humano. | Os caçadores 2 e 3 (O Carcereiro e O Lamento, §4.2) entram na fase 4. O caçador controlado por pessoa entra na fase 3, junto com o multiplayer; na v1.0, "Jogar de caçador" é o papel de caçador nas filas casual e ranked. **Decidido (D-09 a).** | Rodrigo e filho, 08/11/2026 |
| C-16 | §7.6 | Não há métrica para o pilar 3 "objetivos opcionais de risco/recompensa" (geradores bônus). | **LACUNA** registrada; proposta de métrica de telemetria "partidas com ≥ 1 bônus concluído" na fase 5, sem banda até haver dados. | — |

O código do protótipo foi conferido linha a linha contra a tabela 2.3 em [`prototipo-paridade.md`](prototipo-paridade.md): todos os valores batem, e 11 comportamentos fora do GDD ficam registrados lá. Correção factual: o protótipo tem 22 KB, não ~45 KB (§2.5). Correção de pontos (P-12): no protótipo, um gerador completo vale 90 pontos (5 quebra-cabeças × 10 + 40 ao concluir), não 50 como diz o §2.3; o porte mantém 90.

Itens vagos fora das seções 8 a 13, registrados para a fase 1 sem decisão aqui: tempo extra de gaiola no último resgate (§4.3, sem valor); categorias de pontos (§7.1, quase todas [Proposta]); evolução das classes (§5.2).

---

## Δ2. Matriz de rastreabilidade (MDA)

Cada mecânica liga um pilar (§1) a um parâmetro de dados e a uma métrica que diz se ela funciona. Mecânica sem métrica é lacuna.

| Pilar (§1) | Mecânica | Parâmetros (`data/balance.yaml`) | Métrica (§7.6, §15.3 ou Art Bible) |
| --- | --- | --- | --- |
| 1. Cooperação sob pressão | Resgate na gaiola; cura; penalidade de classe repetida | `cage.*`, `classes.healer.*`, `classes.repeat_penalty` | Taxa de fuga 45–55%; uso de cada classe 20–35% |
| 2. Tensão sem gore | Ruído e detecção; revelação periódica; música por distância | `noise.*`, `hunter.detect_radius`, `hunter.reveal.*`, `audio.music.tension_radius` | Capturas 1,5–2,5 por partida; pergunta "tensão" do questionário de playtest (§15.4) |
| 3. Partidas curtas e rejogáveis | Geradores escalados por time; portão; limite duro | `generator.*`, `match.hard_time_limit` | Duração 6–8 min; < 5% abaixo de 3 min; abandono < 8% |
| 3. (risco/recompensa) | Geradores bônus | `generator.by_team_size.*.bonus`, `points.bonus_*` | LACUNA (C-16) |
| 4. Assimetria justa | Velocidades; telegraph ≥ 0,4 s; anti-tunnel; atordoamentos | `hunter.chase_speed`, `survivor.walk/run`, `hunter.telegraph_min`, `hunter.anti_tunnel`, `classes.fighter.strike.stun` | Vitória do caçador 45–55% por faixa de MMR |
| 5. Leitura clara | Paleta por classe e estado; feixes de gerador; seta de ameaça | `data/art/palette.json`, `ui.threat_radius` | Testes da Art Bible (silhueta < 1 s, daltonismo, contraste); pergunta "clareza" do questionário |

---

## §3.3 revisto. Condições de fim [Especificado] Δ

1. **Individual:** Escapou (vitória) ou Morto (derrota).
2. **Equipe:** a equipe vence se pelo menos 1 sobrevivente escapar ou se a vida do caçador chegar a 0 (D-01 b). Em qualquer outro caso, o caçador vence. O resultado individual continua separado: quem morreu perde, mesmo com o time vencendo.
3. **Fim da partida:** quando todos os sobreviventes estão em estado terminal, quando a vida do caçador chega a 0 ou no limite duro (`match.hard_time_limit`, 600 s, D-02 a). No limite, quem não escapou conta como não escapado e não perde pontos já ganhos.
4. Jogador morto vira espectador (sem mudança).

**Aceite:** teste unitário cobre n = 1 a 5 com todas as combinações de escapados, mortos e caçador derrotado.

---

## §8. Inteligência artificial Δ

### 8.1 Arquitetura [Especificado]

- **Caçador:** árvore de comportamento com escolha de alvo por utilidade. **Bots aliados:** máquina de estados com utilidade. Os dois rodam dentro de `packages/sim`, sem DOM, e consomem só o que um jogador naquela posição receberia (mesmo snapshot filtrado). Esse princípio vem do Caçada Sombria (`src/shared/bots/brain.ts`) e impede que a IA "veja através de paredes".
- **Frequência:** percepção e decisão a 10 Hz (`ai.perception_hz`, `ai.decision_hz`); movimento no passo da simulação (60 Hz).
- **Percepção:**
  - Visão: cone de `hunter.vision_fov_deg` (90°) até o raio de detecção da dificuldade (9/11/13/15 m), com linha de visão por raio contra as caixas de colisão do mapa.
  - Audição: eventos da tabela §3.4 (`noise.*`). Ao ouvir, investiga a posição do som por `ai.hearing_investigate_time` (8 s).
  - Memória: guarda a última posição conhecida pelo tempo da dificuldade (`ai.by_difficulty.*.memory`: 4/8/12/15 s).
  - Revelação periódica: `hunter.reveal.*` (28 s, 2 alvos, 3,5 s).

**Aceite:** teste de percepção com cenários fixos (alvo atrás de parede, fora do cone, dentro do cone além do raio) dá o resultado esperado em 100% dos casos.

### 8.2 Estados do caçador [Especificado]

Patrulha → Investigar → Perseguir → Atacar → Recuo (0,6 s, `hunter.melee.recoil`) → Prender. Patrulha visita geradores com peso proporcional ao progresso de cada um. Na pressão final, patrulha o portão. Carregar o abatido até a gaiola continua **[Proposta]** (G-06).

**Aceite:** log de 1.000 partidas simuladas mostra todas as transições válidas e nenhuma transição fora do grafo.

### 8.3 Escolha de alvo [Especificado]

Fórmula do v0.2 (pesos em `ai.target_weights`), com os termos agora definidos:

- proximidade = 1 − distância ÷ raio de detecção, limitado a [0, 1];
- progresso = fração do gerador em que o alvo trabalha (0 se não trabalha);
- ferido = 1 se a vida estiver abaixo de 40, senão 0;
- isolado = 1 se não há aliado a menos de `ai.isolated_radius` (8 m);
- protegido = 1 se há Atacador (ou Protetor) a menos de `ai.protected_radius` (4 m).

**Δ Histerese:** o caçador só troca de alvo se o novo placar superar o atual em `ai.target_switch_margin` (0,15). Sem isso, dois alvos com placar parecido fazem o caçador hesitar entre eles.

**Aceite:** teste de utilidade com 10 cenários fixos escolhe o alvo esperado; teste de troca não alterna de alvo mais de 1 vez por segundo.

### 8.4 IA por dificuldade [Especificado]

Valores do v0.2 em `ai.by_difficulty`. Definições que faltavam:

- **Conhece loops "parcial" (Normal):** usa dash ou projétil para quebrar o loop depois de `ai.loop_partial_laps_before_break` (2) voltas no mesmo obstáculo. "Sim" (Difícil): quebra na primeira volta. "Evita loops longos" (Pesadelo): não entra em loop com perímetro acima de 18 m e corta caminho pelo navmesh.
- **Previsão de projétil "linear":** mira na posição prevista com a velocidade atual do alvo; "alvo parado": não atira em alvo parado atrás de obstáculo.

### 8.5 Bots aliados [Especificado] Δ (era Proposta)

- Personalidades com parâmetros em `ai.bots.personalities` (Cauteloso foge a 12 m e evita bônus; Ousado foge a 7 m e prioriza bônus; Altruísta foge a 9 m e prioriza resgate e cura).
- Erro humano: 15% de falha em quebra-cabeça e reação a pings de 0,3 a 0,8 s.
- **Fuga competente** (lição do Caçada Sombria, C-15): em perseguição, o bot usa o loop mais próximo dos metadados do mapa, quebra linha de visão e usa a habilidade da classe. Sem isso, o simulador não serve para balancear.
- Proibidos no ranked; em casual, completam vagas e substituem quem sai.

**Aceite:** em 1.000 partidas simuladas de bots contra o caçador Normal, a mediana de tempo de perseguição antes da captura é ≥ 15 s (o v0.2 dá +30 pontos por fugir de perseguição por mais de 15 s; um bot que nunca chega lá não representa um jogador).

### 8.6 Navegação [Especificado]

- Navmesh por mapa gerado no build com recast-navigation-js (`nav.*`: célula 0,1 m, raio do agente 0,5 m para caber no corredor mínimo de 1,6 m, altura 2,5 m, degrau 0,3 m). Grade A* de 0,5 m como reserva (`nav.fallback_grid`).
- **Anti-travamento:** se o deslocamento ficar abaixo de 40% do esperado por 0,7 s, replaneja o caminho (`ai.anti_stuck`). Vale para caçador e bots.

**Aceite (T-03):** 1.000 partidas simuladas por mapa sem nenhuma trava, definida como deslocamento abaixo de 40% do esperado por mais de 3 s com caminho válido (`ai.stuck_fail_after`).

---

## §9. Mapas e level design Δ

### 9.1 Métricas [Especificado]

Valores do v0.2 em `maps.*`, agora verificáveis por um validador de linha de comando (`tools/maps/validate`) que roda na CI:

| Regra | Parâmetro | Como o validador mede |
| --- | --- | --- |
| Corredor ≥ 1,6 m | `maps.corridor_min` | navmesh com raio de 0,8 m conecta todas as áreas jogáveis |
| Todo gerador alcançável | — | caminho no navmesh do spawn a cada gerador, gaiola e saída |
| Geradores a ≥ 25 m entre si | `maps.generator_min_dist` | distância no navmesh, em todos os layouts |
| Loop a cada ~20 m | `maps.loop_coverage_radius`, `maps.loop_coverage_min` | ≥ 90% da área caminhável a menos de 20 m de um loop |
| Loops curtos 8–12 m, longos ≥ 18 m | `maps.loop_short_perimeter`, `maps.loop_long_perimeter_min` | perímetro dos loops marcados nos metadados |
| ≥ 3 esconderijos | `maps.hideouts_min` | contagem nos metadados |
| Caçador nasce a ≥ 35 m | `match.hunter_spawn_min_dist` | distância no navmesh até cada spawn de sobrevivente |
| Vantagem de 6–10 s por volta | `maps.loop_advantage` | medido no simulador (depende de C-07) |

Feixes de luz nos geradores: cores e padrões de piscar na Art Bible §4 (a combinação vermelho/verde do protótipo falha para daltônicos).

### 9.2 Catálogo para a v1.0

A v1.0 tem 3 mapas (§0): o Pátio (porte do protótipo) e mais dois do catálogo §9.2. **Decidido (D-06 c): Floresta Nebulosa e Parque de Diversões.** O Hospital Abandonado fica para a temporada 1.

- **Floresta Nebulosa:** loops longos e baixa visibilidade; a névoa esconde quem não corre (§9.2 do v0.2). Parâmetro novo a definir na fase 4: alcance de visão do caçador sobre quem anda na névoa.
- **Parque de Diversões:** setores temáticos e carrossel que bloqueia a passagem num ciclo de 30 s. Isso traz o único obstáculo móvel do jogo, com três consequências técnicas: o navmesh usa obstáculos dinâmicos (TileCache do recast-navigation-js) em vez de malha fixa; o validador de mapa testa os dois estados do carrossel (aberto e fechado), e todo gerador precisa continuar alcançável nos dois; a IA replaneja o caminho quando o carrossel muda de estado. Risco: é o mapa mais caro do catálogo, e entra no caminho crítico da fase 4.

### 9.3 Variação procedural leve [Especificado] Δ (era Proposta)

Por mapa: 3 a 4 layouts de geradores feitos à mão, 2 posições de gaiola e 2 saídas; a semente da partida escolhe a combinação. O validador roda todas as combinações.

**Aceite:** todas as combinações de todos os mapas passam no validador; a diferença entre a maior e a menor distância média caçador → geradores nas combinações de um mapa é ≤ 20%.

### 9.4 Ferramentas Δ

Layout em `data/maps/<mapa>.json` com paredes (caixas), spawns, geradores por layout, gaiolas, saídas, loops (polígono) e esconderijos. Scripts geram e validam o JSON; o navmesh é gerado no build (C-14). Props e personagens em glTF 2.0.

**Aceite:** Khronos glTF-Validator sem erros em todos os `.glb`.

---

## §10. Direção de arte e gráficos Δ

A regra de forma, cor e legibilidade está na [Art Bible](art-bible.md). Aqui fica o lado técnico.

### 10.1 Pipeline PS1 [Especificado]

Um único material PS1 (shader próprio) aplicado a todo o cenário e personagens, com intensidade de 0 a 1 por efeito (`render.ps1.*`), ajustável no menu de acessibilidade:

1. **Vertex snapping:** posição arredondada em espaço de tela numa grade de 1/128 (`snap_grid`).
2. **Mapeamento afim:** UV interpolado sem correção de perspectiva, misturado com o correto pela intensidade (`affine`). Polígonos grandes de chão e parede são subdivididos no build para limitar a distorção.
3. **Iluminação por vértice (Gouraud)** calculada no shader (C-12).
4. **Dithering ordenado 4×4** e quantização para 5 bits por canal (`dither`, `color_bits`).
5. Névoa linear de 3 a 30 m (`render.fog`); luz pontual que segue o jogador com raio de 24 m.
6. Texturas com filtro nearest; animação amostrada a 12 FPS (`render.anim_fps`).

**Aceite (A-01):** teste de captura de tela compara cada efeito ligado e desligado contra imagens de referência aprovadas; com tudo em 0, a imagem fica sem tremor nem dither.

### 10.2 Camadas visuais [Especificado] Δ (era Proposta)

| Preset | Resolução interna | Camadas | Sombra |
| --- | --- | --- | --- |
| Baixo | 320×180 | A | não |
| Médio (padrão) | 384×216 | A + B | 256 px |
| Alto | 480×270 | A + B + C | 256 px |

Camada A (grão, vinheta, scanlines leves, aberração cromática ao receber dano, bloom nos emissivos, LUT fria) entra na v1.0 em todos os presets. A aberração cromática e o grão respeitam a opção "reduzir flicker".

### 10.3 Personagens e animação [Especificado]

Orçamentos do v0.2 (`render.models`): 300 a 600 triângulos por sobrevivente, 800 a 1.200 por caçador, atlas de 64×64. Nove clipes por personagem (A-02): idle, andar, correr, interagir, ferido, preso, golpe, dash, atordoado. Esqueleto e animações-base podem vir de pacotes CC0 já usados no Caçada Sombria (Quaternius, Universal Animation Library), com troca de proporção por classe.

**Aceite:** script conta triângulos e clipes de cada `.glb` e falha fora do orçamento.

### 10.6 Orçamentos de desempenho [Meta] — como medir

| Meta | Medição | Onde |
| --- | --- | --- |
| Draw calls ≤ 150; triângulos ≤ 60 mil | `renderer.info.render.calls` e `.triangles` na cena de pior caso (6 personagens, mapa inteiro, efeitos) | CI (Playwright headless) |
| Download inicial ≤ 15 MB; por mapa ≤ 40 MB | soma dos arquivos do build por rota | CI |
| Tempo até jogar < 5 s | Playwright com rede limitada a 25 Mbit/s | CI |
| 60 FPS em Intel UHD 620 a 720p | contador de quadros por 60 s na cena de pior caso | **LACUNA:** exige máquina com UHD 620. A CI só mede os itens acima; o FPS real é medido numa máquina do Rodrigo ou de um testador, no fim das fases 2 e 5 |

---

## §11. Áudio Δ

| Item | Especificação | Parâmetro | Aceite |
| --- | --- | --- | --- |
| Música adaptativa | 5 stems (ambiente, tensão, perseguição, pressão final, resgate), transição no início do compasso seguinte com crossfade de 1 compasso. Tensão liga com o caçador a < 25 m; perseguição quando o servidor marca o jogador como alvo em perseguição (sinal booleano, sem enviar a posição do caçador). | `audio.music.*` | Teste com relógio simulado: toda troca de stem cai no limite de compasso (A-03) |
| Áudio espacial | PannerNode HRTF; oclusão por parede com passa-baixa em 800 Hz quando o raio até a fonte cruza parede; reverberação por zona do mapa; limite de 32 vozes por prioridade. | `audio.max_voices`, `audio.occlusion_lowpass_hz` | Teste unitário do gerenciador de vozes (33ª voz derruba a de menor prioridade) |
| Telegraph sonoro | Cada habilidade do caçador tem som próprio que começa junto com o telegraph visual (≥ 0,4 s antes). | `hunter.telegraph_min` | Teste: evento de som emitido ≥ 0,4 s antes do efeito |
| Mixagem | Música masterizada a −16 LUFS integrado (±1), pico real ≤ −1 dBTP; ducking de −8 dB em eventos críticos; sliders de música, efeitos, voz e UI. | `audio.loudness_*`, `audio.ducking_db` | Script com ffmpeg `ebur128` em todos os arquivos de música, na CI |
| Legendas de som | Ícone direcional para passos de corrida, falha de gerador, grito do caçador e resgate. | — | Checklist de acessibilidade (§12.4) |
| Formato e origem | MP3 (C-13); carregamento sob demanda por mapa; samples CC0 com crédito arquivo a arquivo, como em `cacada-sombria-V2/public/media/creditos.csv`. | — | CI falha se um arquivo de áudio não estiver no `creditos.csv` |

---

## §12. UI/UX, controles e acessibilidade Δ

### 12.1 HUD [Especificado]

Itens do v0.2, com os números que faltavam: seta de ameaça na borda quando o caçador está a < 15 m (`ui.threat_radius`) ou revelado, com o servidor enviando só a direção quantizada (8 setores), nunca a posição; 4 pings com recarga de 2 s (`ui.ping_cooldown`); retratos do time com a cor e o ícone da classe (Art Bible §3).

### 12.2 Controles [Especificado]

Remapeamento de todas as ações; gamepad no layout padrão da Gamepad API; sensibilidade, inversão do eixo Y e FOV de 60 a 100 (padrão 75, `ui.fov`). Mobile fica fora da v1.0 (o v0.2 já o põe "em fase posterior").

### 12.3 Tutorial e FTUE [Especificado]

Treino de 60 s com bot passivo (mover, gerador, quebra-cabeça, resgate, habilidade). **Aceite:** telemetria mede do primeiro carregamento ao fim da primeira partida; mediana < 10 min no beta (fase 5).

### 12.4 Acessibilidade [Especificado]

Modo daltônico com 3 paletas (troca de tokens, ver Art Bible §5), redução de flicker, de tremor de vértice e de balanço de câmera (os controles de intensidade do §10.1), quebra-cabeças sem tempo e com zona maior (`puzzles.accessible`), alternar em vez de segurar, fonte em 3 tamanhos, legendas de som.

**Aceite (U-01):** axe-core sem violações WCAG 2.2 AA em todas as telas de menu; navegação completa só por teclado e só por gamepad; teste de contraste da paleta (`tools/art/palette-check.mjs`) na CI.

### 12.5 Localização [Especificado]

pt-BR, en e es desde a fase 1, com chaves de tradução no formato ICU. **Aceite:** a CI falha se alguma chave usada no código faltar em um dos três idiomas.

---

## §13. Arquitetura técnica Δ

### 13.1 Engine [Especificado]

Three.js (WebGL2) + TypeScript, como recomendado no v0.2 e já usado no Caçada Sombria. Colisão própria de cápsula e AABB. ECS leve (bitECS) só se a simulação passar de ~200 entidades; até lá, arrays de componentes simples. Encerra a pendência §19.1.

### 13.2 Repositório [Especificado]

Monorepo com pnpm workspaces: `packages/sim` (regras, IA, determinística, sem DOM), `packages/shared` (tipos, protocolo, leitura de dados), `packages/server` (Colyseus), `packages/client` (render, entrada, UI, áudio; build com Vite). `data/` (YAML + schema), `tools/` (simulador, validadores, arte). Testes com Vitest e Playwright.

### 13.3 Simulação [Especificado]

Passo fixo de 1/60 s nos dois lados (C-11); PRNG mulberry32 com semente por partida (mesmo algoritmo de `cacada-sombria-V2/src/shared/rng.ts`); `Math.random` proibido em `packages/sim` por regra de lint; estado serializável; replay por semente + log de entradas + hash dos dados.

**Aceite (T-02):** a mesma semente e o mesmo log de entradas geram o mesmo hash de estado final em 100 execuções.

### 13.4 Rede [Especificado]

- **Servidor autoritativo em Colyseus** (0.18 no Caçada Sombria; versão a fixar na fase 0). Sala `match` com até 6 clientes (1 caçador + 5); sala de fila por modo (casual, ranked).
- **Snapshot filtrado por jogador** (padrão `GameWorld.snapshotFor` do Caçada Sombria): cada cliente recebe só o que pode ver. O schema do Colyseus fica para o estado público (lobby, placar); posições vão em mensagem binária a 20 Hz, com delta contra o último snapshot confirmado.
- Quantização: posição a 1/64 m em int16 (cobre ±512 m), ângulo em 8 bits.
- Predição local e reconciliação; interpolação de entidades remotas com buffer de 100 ms; compensação de latência com histórico de 150 ms na validação de golpe e projétil.
- Reconexão em até 30 s (`allowReconnection` do Colyseus).
- O host via WebRTC do v0.1 está descartado: a infraestrutura dedicada já está decidida.

Estimativa de banda (**[Meta]** ≤ 20 KB/s): 6 entidades × ~11 bytes + eventos e cabeçalho ≈ 150 bytes por snapshot × 20 Hz ≈ 3 KB/s por cliente. A medir no teste de carga.

**Aceite (T-04):** Playwright com 5 clientes em staging sob 150 ms de latência e 5% de perda (`tc netem`) por 10 min: nenhuma correção de reconciliação acima de 0,5 m e nenhuma divergência de estado de jogo entre clientes.

### 13.5 Backend [Especificado] Δ (substitui o §13.5 do v0.2)

| v0.2 | v0.3 | Por quê |
| --- | --- | --- |
| Postgres | SQLite (`node:sqlite`) em modo WAL no volume do Fly | Uma máquina, um escritor; já em produção no Caçada Sombria (`src/server/profiles.ts`) |
| Redis | Filas e salas em memória do processo | Uma máquina; o Colyseus já mantém as salas em memória |
| CDN Cloudflare | Assets com hash no nome e cache imutável de 365 dias, servidos pela própria máquina | Regra "só Fly.io, sem Cloudflare"; padrão do `build.mjs` do Caçada Sombria |
| Sentry | `POST /api/erro` grava erros do navegador e do servidor no SQLite, com limite por IP | Padrão do Caçada Sombria |
| Prometheus/Grafana | `GET /api/metricas` agregado + métricas da plataforma do Fly. **LACUNA:** confirmar o que o painel do Fly oferece hoje e se tem custo | Teto de custo |
| OAuth Google/Discord | Conta convidada com token aleatório guardado no navegador + código de recuperação; OAuth atrás de feature flag | O Rodrigo não faz configuração longa em várias contas; decidido (D-07 a) |
| Deploy canary | Dois apps no Fly (staging e produção); staging a cada merge, produção com aprovação | Máquina única com volume não comporta canary |

Tabelas: contas, perfis, carteira como livro-razão só de inserção (moedas nunca vêm do cliente), inventário, rating Glicko-2 por papel, partidas, eventos de telemetria, erros, temporadas, denúncias. Backup: snapshots diários de volume do Fly (os primeiros 10 GB de snapshot não são cobrados, segundo a página de preços).

**Aceite (E-01):** teste de integração tenta alterar saldo, comprar sem saldo e repetir a mesma compra; o saldo final confere com o livro-razão em todos os casos.

**Custo mensal estimado** (preços de [docs.fly.io/about/pricing](https://docs.fly.io/about/pricing), consultados em 08/11/2026):

| Componente | Preço de referência | Estimativa |
| --- | --- | --- |
| Produção: 1 máquina shared-cpu-1x 512 MB | US$ 3,69/mês ligada o mês todo (regiões iad/ewr). **LACUNA:** a página não mostra o preço de gru (São Paulo) | ≤ US$ 3,69 + diferença de gru; dorme sem uso |
| Staging: 1 máquina shared-cpu-1x 256 MB | US$ 2,19/mês ligada o mês todo | ~US$ 0,50 (dorme quase sempre) |
| Volumes: 1 GB em cada app | US$ 0,15/GB/mês | US$ 0,30 |
| Saída de dados (América do Sul) | US$ 0,04/GB | ~42 MB por partida de 5 jogadores (20 KB/s de teto × 5 × 7 min); 1.000 partidas ≈ 42 GB ≈ US$ 1,68. Mais 15 MB por jogador novo |
| IPv4 dedicado | US$ 2/mês | US$ 0 (IPv4 compartilhado e IPv6 são gratuitos) |
| GitHub Actions | — | US$ 0 (repositório público) |
| **Total** | | **~US$ 6 a 8/mês** com 1.000 partidas/mês, dentro do teto de US$ 10 se o preço de gru não passar de ~US$ 5 |

A página informa que não há plano gratuito nem franquia mensal para organizações novas. Capacidade de uma máquina (salas simultâneas) é **LACUNA**: medir com `@colyseus/loadtest` na fase 3.

### 13.6 Segurança e privacidade [Especificado]

Sem mudança de regra. Números: o servidor descarta entrada que exceda 1,1× a velocidade máxima ao longo de 5 s (speedhack), limita pings a 1 a cada 2 s e rotas HTTP por IP. LGPD: sem e-mail nem nome real na v1.0 (conta convidada); apelido com filtro de palavrões; aviso de privacidade e consentimento dos responsáveis para menores de 18. **LACUNA:** o texto do aviso e o fluxo de consentimento precisam de revisão jurídica antes do lançamento.

---

## Decisões

Todas tomadas em 08/11/2026 pelo Rodrigo e pelo filho. Registro completo no [plano de construção](plano-construcao.md#7-decisões).

| ID | Decisão | Escolha |
| --- | --- | --- |
| D-01 | Vitória da equipe (C-01) | b) basta 1 escapar |
| D-02 | Limite de tempo (C-02) | a) 10 min |
| D-03 | Velocidade do caçador (C-07) | b) 4,3 m/s em Normal já |
| D-04 | Moedas e preços (C-09) | b) 1 por ponto, skins mais caras |
| D-05 | Simulador na CI (C-15) | a) porta de regressão |
| D-06 | Mapas 2 e 3 (§9.2) | c) Floresta Nebulosa e Parque de Diversões |
| D-07 | Contas (§13.5) | a) convidado com código de recuperação |
| D-08 | Moeda premium e passe (§14.2–14.3) | a) fora da v1.0, atrás de flag |
| D-09 | Caçadores (C-17) | a) caçador humano na fase 3; os 3 caçadores na v1.0 |
| D-16 | Metas de balanceamento com D-01 b (§7.6) | a) vale a vitória do caçador por partida em 45–55%; fuga por sobrevivente só medida |

## Fontes

- `docs/GDD-v0.2.md` (07/11/2026), seções citadas por número.
- `prototype/the-hell.html` (SHA-256 `83e9fc73…a59c0f9`), linhas citadas como L.
- Repositório `rodaquino-OMNI/cacada-sombria-V2`, commit `486320e`: `fly.toml`, `Dockerfile`, `build.mjs`, `.github/workflows/ci.yml`, `src/server/index.ts`, `src/server/profiles.ts`, `src/shared/rng.ts`, `src/shared/predict.ts`, `src/shared/bots/brain.ts`, `docs/balanceamento-v07.md`, `public/media/CREDITOS.md`.
- Preços do Fly.io: [docs.fly.io/about/pricing](https://docs.fly.io/about/pricing), consulta em 08/11/2026.
- WCAG 2.2: [w3.org/TR/WCAG22](https://www.w3.org/TR/WCAG22/).
