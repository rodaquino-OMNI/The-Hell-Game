// Ficha dos personagens (dados de arte, não regra de jogo): proporções, peças da forma-chave e receita dos 9 clipes.
// Fontes: Art Bible §3 (formas-chave e alturas), §7 (orçamento, atlas, 12 FPS, nomes dos clipes); GDD v0.3 §10.3.
// Cores: só tokens de data/art/palette.json (o bake falha com token inexistente).
// Medidas das peças em metros do manequim de origem (Quaternius UAL1, 1,83 m), em pose T, +Y para cima,
// personagem olhando para +Z, +X à esquerda do personagem. O bake escala tudo para a altura do personagem.
// Quem consome: tools/assets/build-characters.ts (gera os .glb) e docs/art/personagens-clipes.md (tabela).

export const CLIP_NAMES = ["idle", "andar", "correr", "interagir", "ferido", "preso", "golpe", "dash", "atordoado"] as const;
export type ClipName = (typeof CLIP_NAMES)[number];

export type V3 = [number, number, number];
type R2 = [number, number];

/** peça low-poly presa a um osso (`osso`); posições relativas à junta `em` (padrão: o próprio osso) */
export type Piece =
  | { forma: "seg"; de: string; ate: string; r: [R2, R2]; lados: number; cor: string; osso?: string; deDesloc?: V3; ateDesloc?: V3; giro?: number }
  | { forma: "caixa"; osso: string; em?: string; desloc: V3; tam: V3; rot?: V3; cor: string; brilho?: boolean }
  | { forma: "elipse"; osso: string; em?: string; desloc: V3; r: V3; lados: number; aneis: number; cor: string; brilho?: boolean }
  | { forma: "cilindro"; osso: string; em?: string; de: V3; ate: V3; r: R2 | [R2, R2]; lados: number; cor: string; giro?: number }
  | { forma: "piramide"; osso: string; em?: string; base: V3; ponta: V3; r: number; cor: string };

/**
 * Receita de um clipe a partir do pacote de origem. `fonte` é o nome no UAL1_Standard.glb.
 * Derivado = `velocidade` ≠ 1 ou `curvar` presente (anotado na tabela de docs/art/personagens-clipes.md).
 */
export interface ClipRecipe {
  fonte: string;
  /** multiplicador de tempo (0,5 = metade da velocidade, clipe dura o dobro) */
  velocidade?: number;
  /** rotação extra somada a um osso em todos os quadros (graus, eixos locais do osso) */
  curvar?: { osso: string; graus: V3 }[];
  laco: boolean;
  nota: string;
}

export interface CharacterSpec {
  id: string;
  nome: string;
  tipo: "sobrevivente" | "cacador";
  /** cor dominante (token) — a da classe ou do caçador */
  cor: string;
  /** altura final em metros (Art Bible §3: sobreviventes 1,70–1,82; caçadores 2,40–2,50) */
  altura: number;
  /** multiplicador do comprimento de braço e antebraço (Espectro: braços que passam do joelho) */
  bracos?: number;
  /** multiplicador do comprimento dos dedos (Espectro: dedos longos) */
  dedos?: number;
  /** mantém os ossos dos dedos (só quem tem dedos modelados) */
  manterDedos: boolean;
  pecas: Piece[];
  clipes: Record<ClipName, ClipRecipe>;
}

// ---------- corpo-base humanoide ----------

interface BodyOpts {
  tronco: string; bracos: string; pernas: string; pele: string; sapato: string;
  /** largura do peito e do abdome [x, z] */
  peito: R2; abdome: R2;
  /** espessura dos membros */
  membro: number;
  lados: number;
  cabeca?: boolean;
}

const side = (s: "l" | "r", x: number) => (s === "l" ? x : -x);

/** 17 peças: quadril, abdome, peito, pescoço, cabeça, braços, antebraços, mãos, coxas, canelas, pés */
function humanoid(o: BodyOpts): Piece[] {
  const m = o.membro, n = o.lados;
  const p: Piece[] = [
    { forma: "caixa", osso: "pelvis", desloc: [0, 0.03, 0.02], tam: [o.abdome[0] * 2.1, 0.2, o.abdome[1] * 2], cor: o.pernas },
    { forma: "seg", de: "spine_01", ate: "spine_03", r: [[o.abdome[0], o.abdome[1]], [o.peito[0] * 0.9, o.peito[1]]], lados: n, cor: o.tronco, giro: 45 },
    { forma: "seg", de: "spine_03", ate: "neck_01", r: [[o.peito[0] * 0.9, o.peito[1]], [o.peito[0], o.peito[1] * 0.9]], lados: n, cor: o.tronco, giro: 45 },
    { forma: "seg", de: "neck_01", ate: "Head", r: [[0.05, 0.05], [0.045, 0.045]], lados: 4, cor: o.pele, giro: 45 },
  ];
  if (o.cabeca !== false) p.push({ forma: "elipse", osso: "Head", desloc: [0, 0.12, 0.02], r: [0.1, 0.13, 0.11], lados: 6, aneis: 4, cor: o.pele });
  for (const s of ["l", "r"] as const) {
    p.push(
      { forma: "seg", de: `upperarm_${s}`, ate: `lowerarm_${s}`, r: [[m * 0.62, m * 0.62], [m * 0.52, m * 0.52]], lados: n, cor: o.bracos, giro: 45 },
      { forma: "seg", de: `lowerarm_${s}`, ate: `hand_${s}`, r: [[m * 0.52, m * 0.52], [m * 0.42, m * 0.42]], lados: n, cor: o.bracos, giro: 45 },
      { forma: "caixa", osso: `hand_${s}`, desloc: [side(s, 0.07), 0, 0.01], tam: [0.13, 0.045, 0.09], cor: o.pele },
      { forma: "seg", de: `thigh_${s}`, ate: `calf_${s}`, r: [[m * 0.95, m * 0.85], [m * 0.72, m * 0.68]], lados: n, cor: o.pernas, giro: 45 },
      { forma: "seg", de: `calf_${s}`, ate: `foot_${s}`, r: [[m * 0.7, m * 0.66], [m * 0.55, m * 0.5]], lados: n, cor: o.pernas, giro: 45 },
      { forma: "caixa", osso: `foot_${s}`, desloc: [0, -0.05, 0.08], tam: [0.1, 0.09, 0.27], cor: o.sapato },
    );
  }
  return p;
}

// ---------- receitas de clipe ----------
// Pacote de origem: Quaternius Universal Animation Library [Standard] (UAL1_Standard.glb), CC0 (creditos.csv).
// O pacote tem 43 clipes; nenhum se chama como os nossos. Fonte direta = clipe do pacote sem alteração além
// da amostragem a render.anim_fps; derivado = tempo ou pose alterados (campos `velocidade`/`curvar`).

const SURVIVOR_CLIPS: Record<ClipName, ClipRecipe> = {
  idle: { fonte: "Idle_Loop", laco: true, nota: "direto" },
  andar: { fonte: "Jog_Fwd_Loop", laco: true, nota: "direto; o passo do protótipo (4 m/s) é de trote, por isso o trote do pacote" },
  correr: { fonte: "Sprint_Loop", laco: true, nota: "direto" },
  interagir: { fonte: "Fixing_Kneeling", laco: true, nota: "direto (conserto ajoelhado no gerador)" },
  ferido: {
    fonte: "Walk_Loop", velocidade: 0.8, laco: true,
    curvar: [{ osso: "spine_02", graus: [18, 0, 0] }, { osso: "Head", graus: [12, 0, 0] }],
    nota: "derivado: caminhada a 0,8× com tronco e cabeça curvados (sem sangue, Art Bible §1.3)",
  },
  preso: { fonte: "Crouch_Idle_Loop", laco: true, nota: "direto (agachado na gaiola)" },
  golpe: { fonte: "Punch_Cross", laco: false, nota: "direto" },
  dash: {
    fonte: "Sprint_Loop", velocidade: 1.5, laco: true,
    curvar: [{ osso: "spine_01", graus: [14, 0, 0] }],
    nota: "derivado: corrida a 1,5× com o tronco inclinado para a frente",
  },
  atordoado: {
    fonte: "Hit_Head", velocidade: 0.35, laco: true,
    curvar: [{ osso: "Head", graus: [0, 0, 10] }],
    nota: "derivado: reação a golpe na cabeça a 0,35× em laço, cabeça tombada",
  },
};

const HUNTER_CLIPS: Record<ClipName, ClipRecipe> = {
  ...SURVIVOR_CLIPS,
  interagir: { fonte: "Interact", laco: false, nota: "direto (pegar / armar armadilha)" },
  preso: { fonte: "Crouch_Idle_Loop", laco: true, nota: "direto; sem uso no caçador hoje, mantido pelos 9 clipes (Art Bible §7)" },
  golpe: { fonte: "Punch_Cross", velocidade: 1.2, laco: false, nota: "derivado: soco a 1,2× (braços longos alcançam mais)" },
};

// ---------- personagens ----------

const MECH_BODY: BodyOpts = { tronco: "class.mecanico", bracos: "class.mecanico", pernas: "world.wall", pele: "ui.text", sapato: "ui.bg", peito: [0.18, 0.11], abdome: [0.14, 0.1], membro: 0.085, lados: 6 };

export const CHARACTERS: CharacterSpec[] = [
  {
    id: "curandeiro", nome: "Curandeiro", tipo: "sobrevivente", cor: "class.curandeiro", altura: 1.75, manterDedos: false,
    pecas: [
      ...humanoid({ tronco: "class.curandeiro", bracos: "class.curandeiro", pernas: "world.wall", pele: "ui.text", sapato: "ui.bg", peito: [0.17, 0.11], abdome: [0.14, 0.1], membro: 0.08, lados: 6 }),
      // capuz arredondado (cobre cabeça e nuca)
      { forma: "elipse", osso: "Head", desloc: [0, 0.13, -0.015], r: [0.13, 0.15, 0.135], lados: 6, aneis: 4, cor: "class.curandeiro" },
      // manto que abre embaixo
      { forma: "seg", de: "spine_02", ate: "pelvis", osso: "pelvis", ateDesloc: [0, -0.5, 0], r: [[0.17, 0.13], [0.3, 0.25]], lados: 6, cor: "class.curandeiro", giro: 30 },
      // cajado mais alto que a cabeça: na pose T fica ao longo do braço direito; com o braço baixado fica de pé
      { forma: "cilindro", osso: "hand_r", de: [-0.85, 0, 0.02], ate: [1.15, 0, 0.02], r: [0.025, 0.025], lados: 4, cor: "ui.text_dim", giro: 45 },
      // caduceu no topo: losango e asas
      { forma: "piramide", osso: "hand_r", base: [1.15, 0, 0.02], ponta: [1.32, 0, 0.02], r: 0.07, cor: "class.curandeiro" },
      { forma: "caixa", osso: "hand_r", desloc: [1.08, 0, 0.02], tam: [0.05, 0.03, 0.3], rot: [0, 0, 0], cor: "ui.text" },
    ],
    clipes: SURVIVOR_CLIPS,
  },
  {
    id: "mecanico", nome: "Mecânico", tipo: "sobrevivente", cor: "class.mecanico", altura: 1.76, manterDedos: false,
    pecas: [
      ...humanoid(MECH_BODY),
      // capacete quadrado no topo da cabeça
      { forma: "caixa", osso: "Head", desloc: [0, 0.2, 0.01], tam: [0.27, 0.14, 0.28], cor: "class.mecanico" },
      { forma: "caixa", osso: "Head", desloc: [0, 0.135, 0.03], tam: [0.31, 0.03, 0.33], cor: "class.mecanico" },
      // lanterna na frente do capacete (emissiva)
      { forma: "caixa", osso: "Head", desloc: [0, 0.2, 0.17], tam: [0.09, 0.07, 0.05], cor: "ui.accent", brilho: true },
      // chave inglesa grande na mão direita: cabo ao longo do braço, boca em U na ponta
      { forma: "caixa", osso: "hand_r", desloc: [-0.33, 0, 0.02], tam: [0.46, 0.045, 0.06], cor: "ui.text_dim" },
      { forma: "caixa", osso: "hand_r", desloc: [-0.59, 0, 0.02], tam: [0.08, 0.06, 0.22], cor: "ui.text_dim" },
      { forma: "caixa", osso: "hand_r", desloc: [-0.66, 0, 0.1], tam: [0.12, 0.06, 0.06], cor: "ui.text_dim" },
      { forma: "caixa", osso: "hand_r", desloc: [-0.66, 0, -0.06], tam: [0.12, 0.06, 0.06], cor: "ui.text_dim" },
    ],
    clipes: SURVIVOR_CLIPS,
  },
  {
    id: "atacador", nome: "Atacador", tipo: "sobrevivente", cor: "class.atacador", altura: 1.76, manterDedos: false,
    pecas: [
      // corpo igual ao do Mecânico, na cor do Atacador, sem capacete (Art Bible §3, pedido A1-1)
      ...humanoid({ ...MECH_BODY, tronco: "class.atacador", bracos: "class.atacador" }),
      // cabelo curto (cabeça livre)
      { forma: "caixa", osso: "Head", desloc: [0, 0.2, -0.01], tam: [0.2, 0.08, 0.21], cor: "ui.bg" },
      // espada nas costas, na diagonal, cabo acima do ombro direito
      { forma: "cilindro", osso: "spine_03", em: "spine_03", de: [0.24, -0.5, -0.19], ate: [-0.14, 0.24, -0.19], r: [[0.05, 0.012], [0.035, 0.012]], lados: 4, cor: "ui.text" },
      { forma: "caixa", osso: "spine_03", em: "spine_03", desloc: [-0.155, 0.27, -0.19], tam: [0.2, 0.04, 0.05], rot: [0, 0, -27], cor: "ui.panel" },
      { forma: "cilindro", osso: "spine_03", em: "spine_03", de: [-0.165, 0.29, -0.19], ate: [-0.25, 0.46, -0.19], r: [0.025, 0.025], lados: 4, cor: "class.atacador" },
    ],
    clipes: { ...SURVIVOR_CLIPS, golpe: { fonte: "Sword_Attack", laco: false, nota: "direto (golpe de espada)" } },
  },
  {
    id: "batedor", nome: "Batedor", tipo: "sobrevivente", cor: "class.batedor", altura: 1.72, manterDedos: false,
    pecas: [
      ...humanoid({ tronco: "class.batedor", bracos: "class.batedor", pernas: "world.wall", pele: "ui.text", sapato: "ui.bg", peito: [0.14, 0.09], abdome: [0.11, 0.08], membro: 0.068, lados: 6 }),
      // cabeça com ponta (capuz pontudo)
      { forma: "piramide", osso: "Head", base: [0, 0.2, -0.01], ponta: [0, 0.42, -0.07], r: 0.11, cor: "class.batedor" },
      // cachecol: volta no pescoço e duas pontas que voam para trás
      { forma: "seg", de: "neck_01", ate: "Head", osso: "neck_01", r: [[0.085, 0.085], [0.08, 0.08]], lados: 6, cor: "ui.accent" },
      { forma: "caixa", osso: "spine_03", em: "neck_01", desloc: [0.04, -0.02, -0.25], tam: [0.08, 0.025, 0.36], rot: [-14, 8, 0], cor: "ui.accent" },
      { forma: "caixa", osso: "spine_03", em: "neck_01", desloc: [-0.03, -0.07, -0.42], tam: [0.07, 0.025, 0.3], rot: [-24, -10, 0], cor: "ui.accent" },
    ],
    clipes: SURVIVOR_CLIPS,
  },
  {
    id: "protetor", nome: "Protetor", tipo: "sobrevivente", cor: "class.protetor", altura: 1.82, manterDedos: false,
    pecas: [
      // corpo largo e reto (seção de 4 lados), armadura prata
      ...humanoid({ tronco: "class.protetor", bracos: "class.protetor", pernas: "world.wall", pele: "ui.text", sapato: "ui.bg", peito: [0.27, 0.15], abdome: [0.24, 0.14], membro: 0.1, lados: 4 }),
      // ombreiras
      { forma: "caixa", osso: "upperarm_l", desloc: [0.04, 0.05, 0], tam: [0.16, 0.08, 0.17], cor: "class.protetor" },
      { forma: "caixa", osso: "upperarm_r", desloc: [-0.04, 0.05, 0], tam: [0.16, 0.08, 0.17], cor: "class.protetor" },
      // escudo redondo preso no braço esquerdo (na pose T a face aponta para +Y; com o braço baixado, para fora)
      { forma: "cilindro", osso: "lowerarm_l", de: [0.14, 0.06, 0], ate: [0.14, 0.1, 0], r: [0.3, 0.3], lados: 10, cor: "class.protetor" },
      { forma: "cilindro", osso: "lowerarm_l", de: [0.14, 0.1, 0], ate: [0.14, 0.14, 0], r: [[0.1, 0.1], [0.05, 0.05]], lados: 6, cor: "ui.text_dim" },
    ],
    clipes: SURVIVOR_CLIPS,
  },
  {
    id: "espectro", nome: "Espectro", tipo: "cacador", cor: "hunter.espectro", altura: 2.5, bracos: 1.6, dedos: 1.7, manterDedos: true,
    pecas: [
      // alto e magro; cabeça oval alongada, sem rosto; dois olhos vermelhos emissivos (Art Bible §3)
      ...humanoid({ tronco: "hunter.espectro", bracos: "hunter.espectro", pernas: "hunter.espectro", pele: "hunter.espectro", sapato: "ui.panel", peito: [0.13, 0.08], abdome: [0.09, 0.07], membro: 0.06, lados: 8, cabeca: false }),
      { forma: "elipse", osso: "Head", desloc: [0, 0.16, 0.01], r: [0.085, 0.19, 0.1], lados: 8, aneis: 7, cor: "hunter.espectro" },
      { forma: "caixa", osso: "Head", desloc: [0.035, 0.18, 0.1], tam: [0.035, 0.022, 0.02], cor: "hunter.olhos", brilho: true },
      { forma: "caixa", osso: "Head", desloc: [-0.035, 0.18, 0.1], tam: [0.035, 0.022, 0.02], cor: "hunter.olhos", brilho: true },
      // farrapos do manto pendurados do quadril
      { forma: "seg", de: "spine_01", ate: "pelvis", osso: "pelvis", ateDesloc: [0, -0.32, -0.02], r: [[0.1, 0.08], [0.15, 0.12]], lados: 8, cor: "ui.panel", giro: 22.5 },
      // dedos longos (4 dedos + polegar, 3 falanges cada, nas duas mãos)
      ...(["l", "r"] as const).flatMap(s => ["index", "middle", "ring", "pinky", "thumb"].flatMap(f => [
        { forma: "seg" as const, de: `${f}_01_${s}`, ate: `${f}_02_${s}`, r: [[0.012, 0.012], [0.011, 0.011]] as [R2, R2], lados: 4, cor: "hunter.espectro", giro: 45 },
        { forma: "seg" as const, de: `${f}_02_${s}`, ate: `${f}_03_${s}`, r: [[0.011, 0.011], [0.009, 0.009]] as [R2, R2], lados: 4, cor: "hunter.espectro", giro: 45 },
        { forma: "seg" as const, de: `${f}_03_${s}`, ate: `${f}_04_leaf_${s}`, r: [[0.009, 0.009], [0.004, 0.004]] as [R2, R2], lados: 4, cor: "hunter.espectro", giro: 45 },
      ])),
    ],
    clipes: HUNTER_CLIPS,
  },
];
