// Ficha dos personagens: a fonte é data/art/personagens.json (schema em packages/shared/src/art.ts, validado por
// `pnpm data`). Aqui ela vira a lista de peças que o bake consome: o corpo-base humanoide (17 peças) é expandido
// a partir de `corpo`, os dedos modelados a partir de `dedosModelados` e os clipes a partir do conjunto nomeado.
// Fontes: Art Bible §3 (formas-chave e alturas), §7 (orçamento, atlas, 12 FPS, nomes dos clipes); GDD v0.3 §10.3.
// Quem consome: tools/assets/build-characters.ts (gera os .glb), testes e docs/art/personagens-clipes.md (tabela).
import { CLIP_NAMES, resolveClips, variantIds, type ClipName, type ClipRecipe, type Sheet, type SheetCharacter, type SheetPiece } from "@thehell/shared";
import sheetJson from "@thehell/shared/generated/personagens.json";

export { CLIP_NAMES, type ClipName, type ClipRecipe };

export type V3 = [number, number, number];
type R2 = [number, number];

/** peça low-poly presa a um osso (`osso`); posições relativas à junta `em` (padrão: o próprio osso) */
export type Piece = SheetPiece;

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
  /** ponto onde a skin prende o acessório pequeno (osso e deslocamento, unidade das peças) */
  acessorio?: { osso: string; desloc: V3 };
  /** variante de arte assada (ficha `variantes`); ausente se o personagem não tem variantes */
  variante?: string;
}

const side = (s: "l" | "r", x: number) => (s === "l" ? x : -x);

/** 17 peças: quadril, abdome, peito, pescoço, cabeça, braços, antebraços, mãos, coxas, canelas, pés */
function humanoid(o: SheetCharacter["corpo"]): Piece[] {
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

/** dedos modelados: 4 dedos + polegar, 3 falanges cada, nas duas mãos */
function fingers(d: NonNullable<SheetCharacter["dedosModelados"]>): Piece[] {
  const joints = ["01", "02", "03", "04_leaf"];
  return (["l", "r"] as const).flatMap(s => ["index", "middle", "ring", "pinky", "thumb"].flatMap(f => d.falanges.map((r, k): Piece => ({
    forma: "seg", de: `${f}_${joints[k]}_${s}`, ate: `${f}_${joints[k + 1]}_${s}`, r: r as [R2, R2], lados: d.lados, cor: d.cor, ...(d.giro !== undefined ? { giro: d.giro } : {}),
  }))));
}

const strip = <T extends { $comment?: string }>(o: T): Omit<T, "$comment"> => { const rest = { ...o }; delete rest.$comment; return rest; };

/** um personagem da ficha → especificação de bake, na variante pedida (padrão: `variantes.padrao`) */
export function expandCharacter(sheet: Sheet, c: SheetCharacter, variante: string | undefined = c.variantes?.padrao): CharacterSpec {
  const extra = variante === undefined ? [] : c.variantes?.lista[variante]?.pecas;
  if (!extra) throw new Error(`${c.id}: variante '${variante}' inexistente`);
  return {
    id: c.id, nome: c.nome, tipo: c.tipo, cor: c.cor, altura: c.altura,
    ...(c.bracos !== undefined ? { bracos: c.bracos } : {}),
    ...(c.dedos !== undefined ? { dedos: c.dedos } : {}),
    manterDedos: c.manterDedos,
    pecas: [...humanoid(c.corpo), ...c.pecas.map(p => strip(p) as Piece), ...extra.map(p => strip(p) as Piece), ...(c.dedosModelados ? fingers(c.dedosModelados) : [])],
    clipes: resolveClips(sheet, c.clipes),
    ...(c.acessorio ? { acessorio: { osso: c.acessorio.osso, desloc: c.acessorio.desloc } } : {}),
    ...(variante !== undefined ? { variante } : {}),
  };
}

/** ficha validada (data/art/personagens.json) → especificação de bake de cada personagem, na variante padrão */
export function expandSheet(sheet: Sheet): CharacterSpec[] {
  return sheet.personagens.map(c => expandCharacter(sheet, c));
}

/** todas as variantes de todos os personagens (a padrão primeiro): o bake mede o orçamento de cada uma */
export function expandVariants(sheet: Sheet): CharacterSpec[][] {
  return sheet.personagens.map(c => variantIds(c).map(v => expandCharacter(sheet, c, v)));
}

/** ficha validada que `pnpm data` copiou de data/art/personagens.json para packages/shared/generated/ */
export const SHEET = sheetJson as unknown as Sheet;
export const CHARACTERS: CharacterSpec[] = expandSheet(SHEET);
