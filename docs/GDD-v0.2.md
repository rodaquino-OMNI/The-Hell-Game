# THE HELL — Game Design Document v0.2

**Plano técnico de produção pós-protótipo · 07/11/2026**

Este documento substitui o rascunho v0.1 e consolida tudo o que foi decidido e validado no protótipo jogável. Foi escrito para que um orquestrador (ou equipe) assuma o projeto e o leve a nível comercial sem depender da conversa original. Onde o protótipo tem um valor numérico, ele é registrado como baseline de balanceamento.

Legenda: **\[Implementado\]** existe no protótipo · **\[Especificado\]** decisão tomada, a construir · **\[Proposta\]** sugestão a validar em playtest · **\[Meta\]** alvo mensurável.

## 0. Resumo executivo

- **Produto:** THE HELL, multiplayer assimétrico 1 caçador vs 1 a 5 sobreviventes, terror leve sem gore, estética retrô PS1, partidas de 5 a 9 minutos, navegador primeiro.
- **Baseline atual \[Implementado\]:** protótipo offline em um único HTML (Three.js r128) com 1 mapa, 1 caçador com IA, 3 classes, 2 bots aliados, 4 geradores obrigatórios + 3 geradores bônus, prisão, portão, pontos, moedas e loja de skins.
- **Alvo da v1.0 \[Meta\]:** multiplayer online com servidor autoritativo, 3 mapas, 5 classes, 3 caçadores, contas, ranking, loja cosmética, telemetria e anti-cheat básico.
- **Decisões-chave:** (1) migrar para base TypeScript modular com simulação determinística separada do render; (2) servidor autoritativo em Node.js; (3) pipeline visual PS1 autêntico com camada opcional de iluminação e pós-processamento; (4) pontos, dificuldade e MMR formalizados; (5) todo balanceamento em arquivos de dados, nunca em código.
- **Regra de ouro \[Especificado\]:** nada pago dá vantagem competitiva. Apenas cosméticos. Sem caixas de loot.

## 1. Visão, pilares e público

**Pitch:** sobreviventes com funções diferentes (curandeiro, mecânico, atacador e outros) cooperam para consertar geradores e escapar de uma criatura sobrenatural. Partidas curtas, tensas e sem gore.

**Pilares de design**

1. **Cooperação sob pressão:** nenhum sobrevivente vence sozinho; cada classe tem papel claro.
2. **Tensão sem gore:** o medo vem de som, perseguição e incerteza.
3. **Partidas curtas e rejogáveis:** de 5 a 9 minutos, mapas variados, objetivos opcionais de risco/recompensa.
4. **Assimetria justa:** o caçador é forte, mas todo poder dele tem aviso, contra-jogo e recarga; os sobreviventes podem derrotá-lo.
5. **Leitura clara \[Proposta\]:** informação crítica (quem está preso, onde há gerador, nível de ameaça) legível em menos de 1 s mesmo no estilo granulado.

**Público \[Proposta\]:** jogadores casuais e semi-hardcore de DBD, Phasmophobia e Among Us que querem sessões curtas; streamers. Classificação alvo: 12+ (violência fantasiosa, sem sangue). Validar com ClassInd e ESRB antes do lançamento.

## 2. Baseline: o que o protótipo faz hoje

### 2.1 Stack e arquitetura \[Implementado\]

- HTML único, Three.js r128 via CDN. Canvas interno **384×216** escalado com image-rendering pixelated (look PS1). Texturas 32×32 geradas por canvas com NearestFilter, MeshLambertMaterial com flatShading, névoa linear de 3 a 30 m, luz ambiente + luz pontual (raio 24) que segue o jogador.
- Simulação e render no mesmo loop (requestAnimationFrame, dt limitado a 50 ms). Colisão círculo vs caixa (AABB). Persistência em localStorage (moedas e skins).
- Áudio WebAudio com osciladores: batimento cardíaco que acelera conforme o caçador se aproxima e bipes de feedback.
- Câmera 3ª pessoa por padrão (ombro a 0,8 m, distância 3,6 m, altura 2,3 m, com recuo automático contra paredes) e 1ª pessoa alternável com V.

### 2.2 Controles \[Implementado\]

WASD mover · Shift correr · mouse (pointer lock) ou setas ← → olhar · E interagir (segurar para resgatar) · Q habilidade de classe · clique ataque (Atacador e Mecânico) · V alterna câmera. Sair do quebra-cabeça de gerador: E, Esc, X, Backspace, Shift ou botão na tela; o progresso do gerador é mantido.

### 2.3 Parâmetros finais do protótipo (baseline de balanceamento)

| Sistema | Parâmetro | Valor |
| --- | --- | --- |
| Sobrevivente | Vida | 100 |
| Sobrevivente | Velocidade andar / correr | 4,0 / 5,4 m/s |
| Sobrevivente | Stamina | 100; consumo 15/s correndo; recarga 14/s (10/s em quebra-cabeça) |
| Sobrevivente | Bots andar / fugir | 3,8 / 4,2 m/s |
| Sobrevivente | Armadilha | lentidão ×0,6 por 3 s |
| Caçador | Vida | 80 |
| Caçador | Velocidade perseguição / patrulha | 3,9 / 3,1 m/s (×1,2 na pressão final) |
| Caçador | Golpe | alcance 1,8 m, recarga 1,7 s, dano 15 (18 na pressão final) |
| Caçador | Detecção | 11 m, ou alvo revelado |
| Caçador | Revelação | a cada 28 s, os 2 mais próximos, por 3,5 s |
| Caçador | Alerta por falha em quebra-cabeça | vai ao gerador por 8 s |
| Caçador | Dash | 11 m/s por 0,35 s; recarga 15 s; usa entre 5 e 11 m |
| Caçador | Projétil | 14 m/s, dano 8, recarga 10 s; usa entre 5 e 16 m |
| Caçador | Armadilha | a cada 32 s; raio 0,9 m; desativável pelo Mecânico (E) |
| Prisão | Gaiola | em (0,10); 75 s; 2ª captura = morte |
| Prisão | Resgate | segurar E por 3 s a menos de 2,4 m; volta com 60 de vida e 4 s de imunidade |
| Mapa | Tamanho | 62×62 m, 4 muros de borda + 11 obstáculos de 3,4 m de altura |
| Geradores | Obrigatórios | 4, nos cantos (±22, ±22), 5 quebra-cabeças cada (alterna timing e sequência) |
| Geradores | Bônus | 3 azuis, só pontos, em (±27, 0) e (0, −12) |
| Portão | Abertura | 45 s após o último gerador; saída em z < −28 |
| Pontos | Quebra-cabeça / gerador | +10 / +40 (total 50); bônus +25 / +75 (total 200) |
| Economia | Moedas por partida | 20 + 30 (vitória) + pontos; começa com 150 |
| Loja | Skins | 7, de 80 a 250 moedas, só cosméticas |

**Classes \[Implementado\]**

| Classe | Q | Ataque (clique) | Extras |
| --- | --- | --- | --- |
| Curandeiro | Pulso de cura: +45 de vida em raio 6 m, recarga 10 s | nenhum |  |
| Mecânico | Conserto turbo: +1 quebra-cabeça no gerador a menos de 3 m, recarga 14 s | Parafuso elétrico: alcance 8 m (cone), dano 6, lentidão ×0,5 por 3 s, recarga 6 s só ao acertar | zona de acerto 0,4 (padrão 0,25); desativa armadilhas; bot conserta em 6 s/puzzle (10 s padrão) |
| Atacador | Bloqueio: anula 1 golpe por 5 s, recarga 8 s | Golpe: alcance 3,2 m, dano 12, atordoa 3 s, recarga 5 s |  |

**Quebra-cabeças \[Implementado\]:** timing (marcador a 0,9/s em zona verde, largura 0,25) e sequência de 4 setas (WASD ou setas). Falha gera faísca e chama o caçador por 8 s.

### 2.4 Changelog de decisões tomadas nos testes

1. Piora do caçador: vida 100→80, perseguição 4,4→3,9, patrulha 3,4→3,1, golpe a cada 1,1→1,7 s, detecção 14→11 m, revelação 20→28 s, dash recarga 10→15 s, projétil dano 10→8 e recarga 6→10 s, armadilhas a cada 22→32 s, pressão final ×1,3→×1,2.
2. Melhoria dos sobreviventes: andar 3,6→4,0, correr 5→5,4, menos gasto de stamina, portão 60→45 s, gaiola 60→75 s, resgate com 60 de vida e 4 s de imunidade, zonas de puzzle maiores, bots mais rápidos, cura 35→45, bloqueio 4→5 s.
3. Sair do gerador a qualquer momento (teclas e botão).
4. Loja de skins com moedas persistentes; câmera 3ª pessoa padrão com colisão; correção do bug que fazia o jogador nascer virado para a parede.
5. Pontos por quebra-cabeça e gerador feitos pelo próprio jogador; cooldown do golpe do Atacador 2,5→5 s.
6. Novo ataque do Mecânico (parafuso elétrico) e 3 geradores bônus que só dão pontos.

### 2.5 Limitações conhecidas (dívida técnica)

- IA do caçador detecta por distância, sem linha de visão nem audição; desvio de parede por rotação aleatória pode prendê-lo.
- Sem navmesh; bots simples; sem pathfinding global.
- A partida acaba quando o jogador morre (o GDD pede eliminar todos).
- Sem rede, sem contas; moedas locais são editáveis pelo usuário.
- Modelos de caixas sem animação; sem sombras; áudio sintético; sem música.
- Código monolítico (\~45 KB) sem testes; sem gamepad nem mobile.
- Balanceamento por intuição, sem telemetria.

## 3. Regras formais do jogo

### 3.1 Fases da partida \[Especificado\]

1. **Lobby/preparação (10 a 20 s):** escolha de classe e skin, contagem regressiva, spawn dos sobreviventes agrupados e do caçador distante (mínimo 35 m).
2. **Tarefas (4 a 8 min):** consertar geradores, resgatar, cumprir bônus.
3. **Pressão final (45 s):** todos os geradores prontos; o portão abre; o caçador fica mais rápido e forte; alerta sonoro global.
4. **Fim:** resultados individuais e de equipe, pontos, XP e moedas.

### 3.2 Estados do sobrevivente

OK → Preso (timer) → OK (resgatado, imune 4 s) → Preso (2ª vez) → Morto. Estados terminais: Escapou, Morto. **\[Proposta\]** estado Ferido (menos de 40 de vida): deixa pegadas luminosas (sem sangue) visíveis ao caçador a cada 2 s e corre 10% mais devagar; cura remove.

### 3.3 Condições de fim \[Especificado\]

- Resultado **individual:** Escapou (vitória), Morto (derrota).
- **Equipe:** sobreviventes vencem se pelo menos metade (arredondado para cima) escapar ou se a vida do caçador chegar a zero. O caçador vence com 1 ou mais mortes mais ninguém na saída… regra simplificada: caçador vence se menos da metade escapar.
- Jogador morto vira espectador (câmera nos aliados vivos) e pode ver o caçador; sem comunicação além de pings.

### 3.4 Ruído e detecção \[Especificado\]

| Evento | Raio de ruído | Efeito no caçador |
| --- | --- | --- |
| Andar | 0 m | nada |
| Correr | 10 m | ouve e investiga a posição |
| Falha em quebra-cabeça | 18 m | alerta por 8 s (baseline) |
| Resgate / cura | 6 m | ouve |
| Gerador completo | 25 m | revela o gerador por 3 s |

O caçador também usa visão (cone de 90° até 11 m com linha de visão) e a revelação periódica de 28 s.

### 3.5 Escala por número de sobreviventes

| Sobreviventes | Geradores | Quebra-cabeças | Bônus | Vida do caçador (proposta) |
| --- | --- | --- | --- | --- |
| 1 | 2 | 10 | 1 | 50 |
| 2 | 3 | 15 | 2 | 65 |
| 3 | 4 | 20 | 3 | 80 |
| 4 a 5 | 5 | 25 | 3 | 90 a 100 |

Meta de tempo por quebra-cabeça: 12 a 18 s em partidas cheias e 8 a 12 s solo, calibrado em testes.

## 4. O Caçador

### 4.1 Kit base \[Implementado\]

Golpe corpo a corpo, dash, projétil, armadilhas, rastreamento periódico e pressão final conforme a tabela 2.3. Toda habilidade deve ter **telegraph de pelo menos 0,4 s**, pista sonora única e contra-jogo explícito.

### 4.2 Elenco futuro \[Proposta\]

| Caçador | Identidade | Habilidade ativa | Contra-jogo |
| --- | --- | --- | --- |
| Espectro (lançamento) | rápido e perseguidor | kit base | loops, Atacador, Mecânico |
| O Carcereiro | controle de área | gaiolas portáteis que prendem por 2 s e atrasam o resgate | desativar com Mecânico, destruir com Atacador |
| O Lamento | stealth e som | invisível a mais de 12 m quando parado; grito que revela todos por 2 s (recarga 40 s) | Batedor ping, Curandeiro em grupo |

### 4.3 Anti-frustração \[Especificado\]

- Imunidade de 4 s após resgate; o caçador não pode capturar o mesmo alvo duas vezes em menos de 15 s (anti-tunnel).
- Golpe encadeado limitado: após atingir, o caçador sofre recuo de 0,6 s.
- Se faltarem 60 s para o fim e todos os sobreviventes estiverem presos, o último resgate vale tempo extra de gaiola.

## 5. Sobreviventes e classes

### 5.1 Regras gerais

Vida 100, classes podem se repetir. **Penalidade de repetição \[Especificado\]:** com n unidades da mesma classe, cooldown × 1,5^(n−1) e efeito × (1 + 0,3·(n−1)). Cada classe tem 2 a 4 habilidades.

### 5.2 Classes

| Classe | Papel | Kit atual | Evolução proposta |
| --- | --- | --- | --- |
| Curandeiro | sustentação | pulso de cura | cura focada em aliado caído (recarga 25 s), escudo de 20 de vida por 6 s, pulso de recuperação acelerada |
| Mecânico | economia de tempo | turbo, parafuso, desarmar | gerador instantâneo 1×/partida, quebra-cabeça com zona dupla, torreta de parafusos |
| Atacador | controle do caçador | golpe com stun, bloqueio | contra-ataque ao ser atingido, golpe carregado (dano 20, recarga 12 s) |
| Batedor (pós-MVP) | informação e mobilidade | nenhum | corrida longa (recarga 20 s), ping que marca o caçador por 4 s, atalho/salto sobre obstáculos baixos, esconder-se por 4 s |
| Protetor (pós-MVP) | resgate e tanque | nenhum | resgate em 1,5 s, barreira temporária (6 s), absorve 1 golpe por aliado (recarga 30 s), provocação que atrai o caçador por 3 s |

### 5.3 Árvore de melhorias \[Especificado\]

Cada classe tem níveis de 1 a 5 (XP por partida). Em cada nível o jogador escolhe 1 de 2 melhorias (ex.: Curandeiro: cura +10 ou recarga −1 s). Tetos de segurança: nenhum upgrade reduz cooldown abaixo de 50% do base nem aumenta efeito acima de 150%. Mudanças de upgrade só entre partidas.

## 6. Geradores e quebra-cabeças

### 6.1 Catálogo \[Especificado\]

| Tipo | Status | Descrição | Skill |
| --- | --- | --- | --- |
| Timing | Implementado | parar marcador na zona verde | reflexo |
| Sequência | Implementado | repetir 4 setas | memória motora |
| Fios | Proposta | ligar 4 pares de cores sem cruzar | lógica |
| Válvulas | Proposta | girar 3 válvulas até alinhar | espacial |
| Código | Proposta | 3 dígitos com pistas de comparação | dedução |
| Ritmo | Proposta | 3 batidas no compasso do gerador | ritmo |
| Memória | Proposta | memorizar 5 luzes em 1,5 s | memória |

Todo quebra-cabeça deve: (a) ser cancelável sem perda de progresso do gerador (baseline); (b) ter versão de acessibilidade (zona maior, sem tempo); (c) ter parâmetros de dificuldade em dados.

### 6.2 Falhas e risco \[Especificado\]

- Falha gera ruído de 18 m (baseline) e quebra o ritmo do gerador.
- 3 falhas seguidas no mesmo gerador: regride 1 quebra-cabeça e dá faísca visível por 3 s.
- Geradores completos acendem uma luz que **revela a posição por 3 s** (compensa a velocidade).

### 6.3 Geradores bônus \[Implementado\]

Três geradores azuis opcionais que só dão pontos (25 por quebra-cabeça + 75 ao concluir, total 200), em posições expostas. Não contam para o portão e bots os ignoram. **\[Proposta\]** nível de risco variável: cada bônus tem selo bronze/prata/ouro com pontos 150/200/300 e mais ruído.

## 7. Pontuação, dificuldade e ranking

### 7.1 Pontos por evento (sobrevivente)

| Evento | Pontos | Status |
| --- | --- | --- |
| Quebra-cabeça de gerador | +10 | Implementado |
| Concluir gerador | +40 | Implementado |
| Quebra-cabeça / gerador bônus | +25 / +75 | Implementado |
| Resgatar aliado | +60 | Proposta |
| Curar aliado (efetivo ≥ 20) | +30 | Proposta |
| Bloqueio ou parafuso útil | +25 | Proposta |
| Atordoar ou atrasar o caçador | +40 | Proposta |
| Fugir de perseguição por mais de 15 s | +30 | Proposta |
| Desativar armadilha | +15 | Proposta |
| Escapar | +100 | Proposta |

Categorias para exibição no fim da partida (inspiradas nos emblemas de DBD): **Objetivos, Altruísmo, Sobrevivência, Audácia**. Pontos do caçador: captura +50, golpe +15, abate +100, perseguição longa +30, revelação eficaz +20, evitar resgate +40.

### 7.2 Moedas e XP \[Especificado\]

- **Baseline:** moedas = 20 + 30·vitória + pontos (1:1). **Problema identificado:** com cerca de 150 a 250 pontos por partida o jogador compra uma skin por partida.
- **\[Proposta\]** moedas = 20 + 30·vitória + 0,3·pontos (aprox. 80 a 140 por partida), com skins de 300 a 1500; XP de classe = pontos × multiplicador de dificuldade.

### 7.3 Níveis de dificuldade \[Especificado\]

| Parâmetro | Fácil | Normal (baseline) | Difícil | Pesadelo |
| --- | --- | --- | --- | --- |
| Vida do caçador | 60 | 80 | 100 | 120 |
| Velocidade de perseguição | 3,5 | 3,9 | 4,2 | 4,5 |
| Recarga do golpe | 2,2 s | 1,7 s | 1,4 s | 1,2 s |
| Raio de detecção | 9 m | 11 m | 13 m | 15 m |
| Revelação | 35 s | 28 s | 22 s | 18 s |
| Tempo de gaiola | 90 s | 75 s | 60 s | 45 s |
| Abertura do portão | 35 s | 45 s | 55 s | 60 s |
| Zona de acerto | ×1,3 | ×1 | ×0,8 | ×0,65 |
| Dano do projétil | 6 | 8 | 10 | 12 |
| Intervalo de armadilhas | 40 s | 32 s | 26 s | 20 s |
| Multiplicador de pontos | ×0,8 | ×1 | ×1,3 | ×1,6 |

### 7.4 Dificuldade dinâmica (DDA) \[Proposta\]

Vale só contra bots e em modo casual; desligada no ranked e com opção de desativar. Índice de desempenho = média das últimas 5 partidas de (taxa de fuga, tempo vivo ÷ duração, geradores por minuto). Acima de 0,7: caçador +5% a +15% de velocidade e −5% a −15% de recarga; abaixo de 0,3: ajuste inverso. Limite de ±15% e visível no resumo da partida.

### 7.5 Ranking \[Especificado\]

Glicko-2 separado por papel (caçador e sobrevivente). Rating de time = média ponderada. Tiers: Ferro, Bronze, Prata, Ouro, Platina, Diamante, Inferno (top 1%). Ranked sem bots, com fila por rating e deviação, temporadas de 8 semanas com soft reset.

### 7.6 Metas de balanceamento \[Meta\]

| Métrica | Alvo |
| --- | --- |
| Taxa de fuga por sobrevivente (4 jogadores) | 45% a 55% |
| Taxa de vitória do caçador por faixa de MMR | 45% a 55% |
| Duração média | 6 a 8 min |
| Capturas por partida | 1,5 a 2,5 |
| Partidas encerradas em menos de 3 min | menos de 5% |
| Uso de cada classe | 20% a 35% |
| Abandono antes do fim | menos de 8% |

## 8. Inteligência artificial

### 8.1 Arquitetura \[Especificado\]

- **Caçador:** árvore de comportamento (Behavior Tree) com pontuação de utilidade (Utility AI) para escolher alvos. **Bots aliados:** máquina de estados com utilidade.
- **Navegação:** navmesh por mapa (Recast/Detour via WASM, ex.: recast-navigation-js), com fallback em grade A\* de 0,5 m. Substitui o desvio por rotação aleatória do protótipo.
- **Percepção:** visão (cone de 90°, 11 m, raycast contra BVH/AABB), audição (eventos da tabela 3.4), memória da última posição conhecida (decai em 8 s) e revelação periódica de 28 s.

### 8.2 Estados do caçador

Patrulha (rota entre geradores ponderada pelo progresso) → Investigar (ruído ou alerta) → Perseguir → Atacar → Recuo pós-golpe (0,6 s) → Prender. **\[Proposta\]** carregar o abatido até a gaiola (4 s) com chance de interrupção pelo Atacador; na pressão final, patrulhar o portão.

### 8.3 Escolha de alvo (utilidade)

score(alvo) = 0,35·proximidade + 0,25·progresso do gerador em que trabalha + 0,20·ferido + 0,15·isolado − 0,25·protegido por Protetor/Atacador próximo. Pesos em dados e variam por nível de dificuldade. Pseudocódigo no Apêndice C.

### 8.4 IA por dificuldade

| Parâmetro | Fácil | Normal | Difícil | Pesadelo |
| --- | --- | --- | --- | --- |
| Tempo de reação | 0,6 s | 0,4 s | 0,25 s | 0,15 s |
| Previsão de projétil | não | não | linear | linear + alvo parado |
| Conhece loops | não | parcial | sim | sim, evita loops longos |
| Memória da última posição | 4 s | 8 s | 12 s | 15 s |

### 8.5 Bots aliados \[Proposta\]

- Três personalidades: **Cauteloso** (foge a 12 m, evita bônus), **Ousado** (foge a 7 m, prioriza bônus), **Altruísta** (prioriza resgate e cura).
- Erro humano simulado: 15% de falha em quebra-cabeças, atraso de 0,3 a 0,8 s para reagir a pings.
- Usam os mesmos kits e restrições de recarga do jogador. Proibidos no ranked; em casual, backfill quando um humano sai.
- **Anti-stuck:** se o deslocamento ficar abaixo de 40% do esperado por 0,7 s, replanejar caminho no navmesh.

## 9. Mapas e level design

### 9.1 Métricas \[Especificado\]

- Corredores com no mínimo 1,6 m; paredes de 3,4 m; mapa médio de 60 a 80 m de lado.
- **Loops:** curtos (8 a 12 m de perímetro) e longos (acima de 18 m); cada volta deve render de 6 a 10 s de vantagem ao fugitivo e nunca ser infinita (o caçador tem dash e projétil para quebrar loops).
- 1 loop a cada cerca de 20 m, no mínimo 3 esconderijos por mapa, distância mínima de 25 m entre geradores, e nenhuma zona totalmente segura (anti-camp).
- Legibilidade: feixes de luz nos geradores (vermelho pendente, amarelo em progresso, verde pronto, azul bônus) \[Implementado\].

### 9.2 Catálogo de mapas

| Mapa | Status | Identidade | Mecânica única |
| --- | --- | --- | --- |
| Pátio (protótipo) | Implementado | 62×62 m, blocos e loops | nenhuma |
| Hospital Abandonado | Proposta | corredores e loops curtos, verticalidade leve | portas trancadas que o Mecânico abre |
| Floresta Nebulosa | Proposta | baixa visibilidade, loops longos | névoa que esconde quem não corre |
| Parque de Diversões | Proposta | setores temáticos | carrossel que bloqueia passagem em ciclo de 30 s |

### 9.3 Variação procedural leve \[Proposta\]

3 a 4 layouts de geradores por mapa, gaiola em 2 posições, 2 saídas possíveis; semente por partida; validador automático de caminhabilidade (todo gerador alcançável) e justiça (distância gerador-caçador).

### 9.4 Ferramentas

Blender → glTF com metadados em JSON (spawns, geradores, loops, gaiolas, esconderijos, navmesh), validador de linha de comando e gerador de navmesh no build.

## 10. Direção de arte e gráficos

### 10.1 Pipeline PS1 autêntico \[Especificado\]

Principais técnicas, todas parametrizáveis de 0 a 1 para acessibilidade:

- Resolução interna 320×240 ou 384×216 com escala inteira, sem antialiasing, texturas nearest \[Implementado\].
- **Vertex snapping:** arredondar vértices em espaço de tela (grade 1/128) para o tremor típico.
- **Affine texture mapping:** shader próprio (atributo noperspective) para distorção de textura em polígonos grandes.
- Dithering ordenado 4×4 com paleta de 15 bits e iluminação por vértice (Gouraud) em vez de por pixel; névoa densa \[Implementado\].

### 10.2 Upgrade visual em camadas \[Proposta\]

| Camada | Custo | Itens |
| --- | --- | --- |
| A (baixo) | baixo | grão de filme, vinheta, scanlines leves, aberração cromática ao receber dano, bloom leve nos emissivos (feixes, lâmpadas), LUT de cor fria |
| B (médio) | médio | lanterna com cone e sombra em shadow map de 256 px pixelado; luz assada nos vértices pelo Blender |
| C (alto) | alto | névoa volumétrica barata (billboards), partículas de poeira, decals (pegadas, riscos), reflexos falsos em poças |

A camada A deve estar na v1.0; B e C são opcionais por preset gráfico (Baixo, Médio, Alto).

### 10.3 Personagens e animação

- Modelos de 300 a 600 triângulos (sobreviventes) e 800 a 1.200 (caçador); texturas atlas de 64×64.
- Esqueleto com animação em passos de 12 FPS (visual PS1). Clipes: idle, andar, correr, interagir, ferido, preso, golpe, dash, atordoado.
- Silhuetas distintas por classe (cor + acessório: caduceu, chave inglesa, arma), paleta amigável a daltônicos.
- Skins por troca de paleta e acessórios; hoje a skin altera cores e chapéu \[Implementado\].

### 10.4 Brief do caçador

Silhueta alta (cerca de 2,5 m), olhos emissivos vermelhos, aura sonora grave. O brilho dos olhos aumenta 0,4 s antes de dash e golpe (telegraph). Sem sangue nem vestimentas gore. Cada novo caçador tem cor dominante e forma de cabeça distintas.

### 10.5 UI estilizada

Fonte pixel, molduras de 2 px com 9-slice, ícones de 16 e 32 px, contraste mínimo 4,5:1.

### 10.6 Orçamentos de desempenho \[Meta\]

| Item | Meta |
| --- | --- |
| FPS | 60 em iGPU (Intel UHD 620) a 720p |
| Draw calls | até 150 |
| Triângulos visíveis | até 60 mil |
| Download inicial | até 15 MB; total por mapa até 40 MB (KTX2/Basis, glTF com Draco) |
| Tempo até jogar | menos de 5 s em banda larga |

Técnicas: InstancedMesh para paredes e props, frustum culling, 2 níveis de LOD, atlas de textura, resolução interna dinâmica em 3 presets.

## 11. Áudio

- **Música adaptativa em camadas** (3 a 5 stems): ambiente, tensão (caçador a menos de 25 m), perseguição, pressão final, resgate; transições no compasso.
- **Áudio espacial:** WebAudio PannerNode (HRTF), oclusão por parede (filtro passa-baixa via raycast), reverberação por zona, limite de 32 vozes.
- **Efeitos:** passos por superfície, respiração ligada à stamina, timbre do gerador por progresso, assinatura sonora única por habilidade do caçador (parte do telegraph), batimento cardíaco \[Implementado como oscilador\].
- **Mixagem:** ducking da música em eventos críticos, alvo de −16 LUFS, sliders separados (música, efeitos, voz, UI), legendas visuais para sons importantes.
- **Pipeline:** arquivos .ogg/.opus, carregamento sob demanda, banco de samples CC0 e foley próprio.

## 12. UI/UX, controles e acessibilidade

### 12.1 HUD \[Especificado\]

Vida e stamina; ícone de habilidade com recarga radial; objetivos (geradores x/N, bônus, pontos) \[Implementado em texto\]; status da equipe com retratos por classe; **indicador direcional de ameaça** (seta vermelha na borda quando o caçador está a menos de 15 m ou foi revelado); pings de 4 tipos (gerador aqui, caçador aqui, preciso de ajuda, vou resgatar); timer do portão; dicas contextuais \[Implementado\]. Respeitar áreas seguras em telas com entalhe.

### 12.2 Controles

Remapeamento completo; gamepad (Gamepad API) com layout padrão; sensibilidade, inversão do eixo Y, FOV de 60 a 100; mobile com joysticks virtuais e mira assistida em fase posterior.

### 12.3 Tutorial e FTUE

Modo Treino com bot passivo (60 s: mover, gerador, quebra-cabeça, resgate, habilidade) e dicas na tela de carregamento. **\[Meta\]** primeira partida concluída em menos de 10 min.

### 12.4 Acessibilidade

- Modo daltônico (3 paletas), redução de flicker, de tremor de vértice e de balanço de câmera.
- Quebra-cabeças sem tempo, alternar em vez de segurar, contraste alto, tamanho de fonte ajustável, indicadores visuais de som.
- Menus em conformidade com WCAG 2.2 AA; aviso de conteúdo (terror leve).

### 12.5 Localização e telas

pt-BR, en e es desde o início (chaves i18n, ICU). Telas: menu, lobby, seleção de classe, loja, perfil e estatísticas, configurações, resumo de partida (categorias de pontos e ajuste de dificuldade), ranking.

## 13. Arquitetura técnica

### 13.1 Escolha de engine

| Opção | Prós | Contras |
| --- | --- | --- |
| **Three.js + TypeScript + Vite (recomendado)** | controle total do pipeline PS1, bundle pequeno, web-first, mesma linguagem do servidor | precisa montar editor, física e UI |
| Babylon.js | inspector, física e UI inclusos, caminho para WebGPU | bundle maior, menos controle de shaders retrô |
| Godot 4 (export web) | editor completo, cenas e animação | export de 10 a 30 MB, limitações de threads no navegador, rede web mais restrita |

Recomendação: Three.js atual (WebGL2) + ECS leve (bitECS) + colisão própria de cápsula e AABB (ou Rapier via WASM se a física crescer). O Godot só se a equipe não programar bem em TypeScript.

### 13.2 Estrutura do repositório

- `packages/sim`: lógica de jogo determinística, sem DOM; `packages/client`: render, input, UI, áudio; `packages/server`: salas em Node.js; `packages/shared`: tipos, protocolo e dados.
- `data/`: balanceamento em JSON (Apêndice A) com validação por schema e hot reload no dev; `tools/`: validador de mapas e simulador headless.
- Testes: Vitest para a simulação, Playwright para e2e, CI no GitHub Actions.

### 13.3 Simulação

Passo fixo de 60 Hz no cliente e 30 Hz (ou 60) no servidor; PRNG com semente (mulberry32 ou pcg32), proibido Math.random na simulação; estado serializável; replays por log de entradas.

### 13.4 Rede

- **Servidor autoritativo.** Transporte inicial WebSocket; evoluir para WebRTC DataChannel ou WebTransport para menor latência.
- Snapshots delta a 20 Hz, interpolação de entidades remotas com buffer de 100 ms, **predição local e reconciliação** do jogador, **compensação de latência** (rewind de até 150 ms) na validação de golpes e projéteis.
- Quantização (posição 1/64 m, ângulo 8 bits). **\[Meta\]** até 20 KB/s por cliente; jogável até 150 ms de ping, aviso acima de 200 ms; reconexão em até 30 s.
- Lobby por HTTP; matchmaking por região e rating; backfill.
- **Opção de orçamento mínimo (do GDD v0.1):** partidas com um jogador como host via WebRTC. Aceita o risco de trapaça; migrar para servidor dedicado barato (2 vCPU atende cerca de 40 salas pequenas) quando houver tração.

### 13.5 Backend

Contas (Google/Discord via OAuth e convidado vinculado depois), perfis, inventário e **moedas sempre no servidor**; Postgres + Redis; API REST; CDN (ex.: Cloudflare) para assets; observabilidade (Sentry, Prometheus/Grafana); feature flags; deploy canary; versionamento semântico do protocolo. Migração: moedas e skins do localStorage são importadas uma vez como convidado, com teto, para não quebrar a economia.

### 13.6 Segurança e privacidade

Validação de tudo no servidor (velocidade máxima, alcance de golpe, recargas), limites de taxa, detecção de speedhack por taxa de movimento, denúncias e banimento. LGPD: consentimento, minimização de dados e consentimento dos responsáveis para menores. Sem chat de texto livre no lançamento (apenas pings), o que reduz custo de moderação.

## 14. Meta-jogo, economia e live-ops

### 14.1 Progressão \[Especificado\]

- **XP de conta** (nível de perfil) e **XP de classe** (níveis 1 a 5, com a árvore de melhorias da seção 5.3). XP = pontos da partida × multiplicador de dificuldade.
- **Missões:** 3 diárias e 3 semanais (ex.: consertar 5 geradores, resgatar 2 aliados, escapar sem ser atingido), recompensa de 50 a 150 moedas. 30 conquistas no lançamento. Perfil com estatísticas por classe.

### 14.2 Moedas e desbloqueios

- **Moeda comum (ganha jogando):** compra cosméticos, novas classes e melhorias de habilidade (conforme o GDD v0.1). Classes novas custam de 1.500 a 3.000 moedas comuns, para que nada de gameplay dependa de dinheiro real.
- **Moeda premium (comprada):** só para cosméticos exclusivos. **Regra de ouro:** nenhuma classe, habilidade ou melhoria é vendida por moeda premium.
- Ritmo alvo: uma skin comum a cada 3 a 5 partidas (ver 7.2).

### 14.3 Cosméticos e monetização \[Proposta\]

- Raridades: Comum, Raro, Épico, Lendário. Skins de sobrevivente por classe, skins de caçador, cor de ping, rastro de lanterna, emotes, molduras de perfil. Hoje há 7 skins de cores e chapéus \[Implementado\].
- Preços de referência: 300 a 1.500 moedas comuns; R$ 9,90 a R$ 39,90 em premium. Passe de temporada com trilha gratuita e trilha paga **apenas cosmética**. **Sem caixas de loot**, preço sempre visível, prévia do personagem na loja, rotação semanal de ofertas.
- Doações (GDD v0.1): página de apoio e insignia cosmética de apoiador.

### 14.4 Modos de jogo

| Modo | Descrição | Ranking |
| --- | --- | --- |
| Casual | com bots e backfill, DDA opcional | não |
| Ranked | só humanos, fila por rating | sim |
| Treino | tutorial com bot passivo | não |
| Personalizado | regras ajustáveis (vida do caçador, geradores, dificuldade) | não |
| Desafio diário | semente fixa, placar do dia | placar |
| Jogar de caçador | o jogador controla o caçador contra bots ou humanos | sim (ranking separado) |

### 14.5 Live-ops e social

- Temporadas de 8 semanas; evento sazonal (ex.: Halloween); novo caçador a cada 2 temporadas e novo mapa a cada temporada; patch de balanceamento mensal com changelog público.
- Social: amigos, grupos, convite por link, partidas privadas, espectador e replays (por log de entradas), denúncia e silenciar. **\[Proposta\]** kill-cam do ponto de vista do caçador ao ser capturado.

## 15. Telemetria, balanceamento e QA

### 15.1 Eventos a coletar \[Especificado\]

match\_start/end, generator\_progress, puzzle\_fail, hit, down, rescue, ability\_use, stun, escape, death, ping. Dimensões: mapa, classe, dificuldade, tamanho do time, MMR, versão do build. Anonimizar conforme LGPD.

### 15.2 Simulação headless de balanceamento

O pacote `sim` roda sem render: bots contra a IA do caçador, 10.000 partidas por build durante a noite. O relatório compara com as bandas da seção 7.6 e **falha o CI** se qualquer métrica sair da faixa. Todo parâmetro de balanceamento vem de `data/*.yaml`.

### 15.3 Métricas de produto \[Meta\]

| Métrica | Alvo |
| --- | --- |
| Retenção D1 / D7 / D30 | 35% / 15% / 6% |
| Sessão média | 20 a 30 min (3 a 4 partidas) |
| Tempo de fila | menos de 60 s (casual), menos de 2 min (ranked) |
| Conclusão do tutorial | acima de 80% |
| Conversão para pagantes (média de referência de F2P) | 2% a 4% |

Esses números são metas de referência de mercado para free-to-play e devem ser validadas com dados reais do jogo.

### 15.4 Playtest e QA

- 5 rodadas de playtest (interno, amigos, 20, 50 e 200 jogadores). Cada rodada: gravar tela, mapa de calor de mortes e prisões, questionário de 8 perguntas (clareza, justiça, tensão, tédio, frustração).
- Testes unitários da simulação (cobertura acima de 90% nas regras), e2e com Playwright, regressão visual por screenshots, soak test de 1 h, compatibilidade (Chrome, Edge, Firefox, Safari; 3 faixas de hardware), rede com 5% de perda e 150 ms (tc netem), fuzz do protocolo.

## 16. Benchmarks de mercado e lições

Comparação qualitativa; números de mercado devem ser pesquisados e validados antes de decisões de investimento.

| Referência | O que adotar | O que evitar |
| --- | --- | --- |
| Dead by Daylight | loop de geradores e resgates, variedade de assassinos e poderes, categorias de pontuação, progressão por classe | dependência de loops infinitos, tunneling, filas longas para o lado do caçador |
| Friday the 13th: The Game | objetivos variados e mapas grandes, papel de cada jogador | instabilidade de rede com host, abandono de partida |
| Evil Dead e Texas Chain Saw Massacre (jogos) | papéis claros por equipe, identidade forte de cada lado | assimetria de poder mal calibrada e dificuldade de onboarding |
| Among Us e Phasmophobia | baixa barreira de entrada, partidas curtas, comunicação simples, forte apelo para streamers | dependência exclusiva de voz e toxicidade sem moderação |
| Jogos 3D de navegador (IO games) | carregamento rápido, login opcional, links de convite | monetização agressiva e anúncios intrusivos |

**Diferencial de THE HELL:** partidas de 5 a 9 min, gratuito e direto no navegador, estética PS1 única, geradores bônus de risco e recompensa, dificuldade escalável e ajustável por jogador.

## 17. Roadmap e backlog

### 17.1 Fases (equipe de 4 a 6 pessoas: 2 programação, 2 arte, 1 design/QA, áudio freelance)

| Fase | Objetivo | Duração estimada | Critério de saída |
| --- | --- | --- | --- |
| 0 | Congelar este GDD, criar monorepo, CI e migrar o protótipo para TypeScript modular | 2 semanas | paridade com o baseline 2.3, testes de regressão |
| 1 | Simulação determinística, IA com navmesh, 3 classes, mapa 1, HUD completo | 6 a 8 semanas | partida offline completa, 90% de cobertura de regras |
| 2 | Vertical slice visual: shader PS1, animação, áudio adaptativo, tutorial | 6 a 8 semanas | 60 FPS em iGPU, FTUE abaixo de 10 min |
| 3 | Multiplayer autoritativo, lobby, matchmaking, contas, loja no servidor | 8 a 10 semanas | 5 jogadores jogando com 150 ms de ping sem desync |
| 4 | Conteúdo: mapas 2 e 3, Batedor, Protetor, caçador 2, ranked | 6 semanas | métricas da 7.6 dentro das bandas no simulador |
| 5 | Balanceamento, telemetria, beta fechado, otimização | 4 semanas | retenção D1 acima de 30% no beta |
| 6 | Soft launch e live-ops | contínuo | temporada 1 publicada |

Total estimado: 8 a 10 meses até o soft launch.

### 17.2 Backlog priorizado

| ID | Item | Prioridade | Critério de aceite |
| --- | --- | --- | --- |
| T-01 | Migrar para TypeScript + Vite + monorepo | P0 | build e testes verdes no CI |
| T-02 | Simulação determinística com PRNG e passo fixo | P0 | mesma semente gera mesmo resultado em 100 execuções |
| T-03 | Navmesh e IA com visão, audição e memória | P0 | sem travas em 1.000 partidas simuladas |
| T-04 | Servidor autoritativo + predição e reconciliação | P0 | sem desync perceptível a 150 ms |
| G-01 | Dados de balanceamento em YAML com schema | P0 | trocar valor sem recompilar |
| G-02 | Pontuação completa (7.1) e resumo de partida | P1 | todos os eventos pontuam e aparecem no resumo |
| G-03 | 5 tipos novos de quebra-cabeça | P1 | cada um com versão acessível |
| G-04 | Classes Batedor e Protetor | P1 | kit completo dentro das metas de uso 20% a 35% |
| G-05 | Níveis de dificuldade e DDA | P1 | tabela 7.3 aplicada por dados |
| G-06 | Estado Ferido, carregar abatido, anti-tunnel | P2 | regras 3.2 e 4.3 validadas em playtest |
| A-01 | Shader PS1 (snap, affine, dither) com intensidade | P1 | liga e desliga por opção |
| A-02 | Animação em passos de 12 FPS e modelos finais | P1 | 9 clipes por personagem |
| A-03 | Música adaptativa e áudio espacial | P1 | 5 camadas com transição no compasso |
| U-01 | Gamepad, remapeamento e acessibilidade | P1 | WCAG 2.2 AA nos menus |
| E-01 | Contas, inventário e moedas no servidor | P0 | cliente não consegue alterar saldo |
| E-02 | Loja com prévia 3D e passe cosmético | P2 | sem vantagem competitiva |
| Q-01 | Simulador headless no CI | P0 | relatório das métricas 7.6 por build |

## 18. Riscos

| Risco | Prob. | Impacto | Mitigação |
| --- | --- | --- | --- |
| Multiplayer web difícil e caro | Alta | Alto | protótipo offline e simulação determinística; servidor Node simples; host como plano B |
| Assimetria desbalanceada | Alta | Alto | simulador headless, dados externos, playtests, DDA |
| Classes repetidas quebram o jogo | Média | Alto | penalidade de repetição (5.1) e testes com times de classe única |
| Economia gera pressão para pagar | Média | Médio | ritmo alvo de 3 a 5 partidas por skin, regra de ouro |
| Desempenho em hardware fraco | Média | Alto | orçamentos 10.6, presets e resolução dinâmica |
| Toxicidade e trapaça | Média | Médio | servidor autoritativo, sem chat livre, denúncias |
| Fila vazia (poucos jogadores) | Alta | Alto | bots em casual, backfill, horários de evento, partidas privadas |
| Escopo (muito conteúdo) | Alta | Médio | MVP congelado, fases com critério de saída |

## 19. Pendências e decisões abertas

1. Escolher a engine final (recomendação: Three.js + TypeScript) e fechar a equipe.
2. Definir nome, história e design final dos caçadores e dos mapas.
3. Confirmar regra de vitória em equipe (metade escapa) e a regra de jogador morto virar espectador.
4. Aprovar a conversão de pontos em moedas (0,3) e os preços da loja.
5. Decidir se haverá voz ou chat de texto após o lançamento.
6. Escolher infraestrutura de servidor e regiões (Brasil primeiro).
7. Confirmar faixa etária alvo (12+) e requisitos de consentimento (LGPD).
8. Priorizar mobile (navegador) ou Steam como segunda plataforma.

## Apêndice A — Exemplo de configuração de balanceamento (data/balance.yaml)

```
version: 0.2
difficulty: normal
survivor:
  hp: 100
  walk: 4.0
  run: 5.4
  stamina: {max: 100, drain: 15, regen: 14, regen_puzzle: 10}
hunter:
  hp: 80
  chase_speed: 3.9
  patrol_speed: 3.1
  final_pressure_speed_mult: 1.2
  melee: {range: 1.8, cooldown: 1.7, damage: 15, damage_final: 18}
  detect_radius: 11
  reveal: {interval: 28, targets: 2, duration: 3.5}
  dash: {speed: 11, duration: 0.35, cooldown: 15, min: 5, max: 11}
  projectile: {speed: 14, damage: 8, cooldown: 10, min: 5, max: 16}
  trap: {interval: 32, radius: 0.9, slow: 0.6, slow_time: 3}
cage: {time: 75, rescue_time: 3, rescue_hp: 60, immunity: 4}
generator: {required: 4, puzzles: 5, bonus: 3, gate_time: 45}
points: {puzzle: 10, generator: 40, bonus_puzzle: 25, bonus_generator: 75}
economy: {base_coins: 20, win_coins: 30, points_to_coins: 0.3}
classes:
  healer: {pulse_heal: 45, pulse_radius: 6, cooldown: 10}
  mechanic: {turbo_cooldown: 14, bolt: {damage: 6, slow: 0.5, slow_time: 3, cooldown: 6, range: 8}}
  fighter: {strike: {damage: 12, stun: 3, cooldown: 5, range: 3.2}, block: {time: 5, cooldown: 8}}
```

## Apêndice B — Protocolo de rede (rascunho)

| Mensagem | Direção | Conteúdo | Taxa |
| --- | --- | --- | --- |
| input | cliente → servidor | número de sequência, eixos de movimento, yaw, botões | 60 Hz (agrupado) |
| snapshot | servidor → cliente | tick, entidades (posição, yaw, estado), eventos, delta | 20 Hz |
| action | cliente → servidor | habilidade, interagir, ping, com tick de referência | por evento |
| event | servidor → cliente | acerto, prisão, resgate, gerador, alerta, fim | por evento |
| join/leave/ready | ambos | sala, classe, skin, dificuldade | por evento |
| ack | ambos | confirmação e pings de latência | 1 Hz |

Todas as mensagens levam versão do protocolo e checksum do conteúdo de dados. O servidor ignora ações que violem recarga, velocidade ou alcance.

## Apêndice C — Pseudocódigo e fórmulas

**Escolha de alvo do caçador**

```
for s in sobreviventes_vivos:
  score = 0.35*prox(s) + 0.25*progresso_gerador(s) + 0.20*ferido(s) + 0.15*isolado(s)
  score -= 0.25*protegido(s)
  se visivel(s) ou revelado(s) ou ouvido(s): candidato
alvo = candidato de maior score; se nenhum: investigar ultimo_ruido ou patrulhar
```

**Pontos e moedas**

```
pontos_final = soma(eventos) * mult_dificuldade
moedas = 20 + 30*vitoria + 0.3*pontos_final
xp_classe = pontos_final
```

**DDA (casual)**

```
indice = media(ultimas 5: 0.5*taxa_fuga + 0.3*(tempo_vivo/duracao) + 0.2*geradores_por_min_norm)
ajuste = clamp((indice - 0.5) * 0.3, -0.15, +0.15)
caçador.velocidade *= 1 + ajuste
caçador.cooldowns *= 1 - ajuste
```

**Penalidade de classe repetida**

```
cooldown_n = cooldown_1 * 1.5^(n-1)
efeito_n   = efeito_1 * (1 + 0.3*(n-1))
```
