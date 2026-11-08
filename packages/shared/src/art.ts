// Schema dos dados de arte (V3, F2-03): paleta (data/art/palette.json) e ficha dos personagens
// (data/art/personagens.json). Fontes: Art Bible §2 (tokens), §3 (formas-chave), §7 (modelos, clipes, skins);
// GDD v0.3 §10.3; GDD v0.2 §10.3 ("Skins por troca de paleta e acessórios").
// Validação em `pnpm data` (tools/data/build-data.ts): schema + coerência entre os dois arquivos (`checkArt`).
import { z } from "zod";

/** nomes dos 9 clipes (Art Bible §7, GDD v0.3 §10.3 A-02) */
export const CLIP_NAMES = ["idle", "andar", "correr", "interagir", "ferido", "preso", "golpe", "dash", "atordoado"] as const;
export type ClipName = (typeof CLIP_NAMES)[number];

const num = z.number().finite();
const pos = num.positive();
const V3 = z.tuple([num, num, num]);
const R2 = z.tuple([num, num]);
const comment = { $comment: z.string().optional() };
const token = z.string().regex(/^[a-z]+(\.[a-z0-9_]+)+$/, "token da paleta no formato grupo.nome");
const bone = z.string().min(1);

// ---------- paleta ----------

const rgb5 = z.number().int().min(0).max(31);
export const PaletteSchema = z.object({
  version: z.string(),
  tokens: z.record(token, z.object({ rgb5: z.tuple([rgb5, rgb5, rgb5]), uso: z.string().optional(), forma: z.string().optional(), padrao: z.string().optional() }).strict()),
  tests: z.record(z.string(), z.unknown()),
});
export type PaletteData = z.infer<typeof PaletteSchema>;

// ---------- ficha dos personagens ----------

const seg = z.object({ ...comment, forma: z.literal("seg"), de: bone, ate: bone, r: z.tuple([R2, R2]), lados: z.number().int().min(3), cor: token, osso: bone.optional(), deDesloc: V3.optional(), ateDesloc: V3.optional(), giro: num.optional() }).strict();
const caixa = z.object({ ...comment, forma: z.literal("caixa"), osso: bone, em: bone.optional(), desloc: V3, tam: z.tuple([pos, pos, pos]), rot: V3.optional(), cor: token, brilho: z.boolean().optional() }).strict();
const elipse = z.object({ ...comment, forma: z.literal("elipse"), osso: bone, em: bone.optional(), desloc: V3, r: z.tuple([pos, pos, pos]), lados: z.number().int().min(3), aneis: z.number().int().min(2), cor: token, brilho: z.boolean().optional() }).strict();
const cilindro = z.object({ ...comment, forma: z.literal("cilindro"), osso: bone, em: bone.optional(), de: V3, ate: V3, r: z.union([R2, z.tuple([R2, R2])]), lados: z.number().int().min(3), cor: token, giro: num.optional() }).strict();
const piramide = z.object({ ...comment, forma: z.literal("piramide"), osso: bone, em: bone.optional(), base: V3, ponta: V3, r: pos, cor: token }).strict();
export const PieceSchema = z.discriminatedUnion("forma", [seg, caixa, elipse, cilindro, piramide]);

const clipRecipe = z.object({
  fonte: z.string().min(1),
  /** multiplicador de tempo (0,5 = metade da velocidade, clipe dura o dobro) */
  velocidade: pos.optional(),
  /** rotação extra somada a um osso em todos os quadros (graus, eixos locais do osso) */
  curvar: z.array(z.object({ osso: bone, graus: V3 }).strict()).optional(),
  laco: z.boolean(),
  nota: z.string(),
}).strict();

const clipSet = z.object({ base: z.string().optional(), clipes: z.partialRecord(z.enum(CLIP_NAMES), clipRecipe) }).strict();

/** corpo-base humanoide (17 peças): cores por região e espessuras */
const body = z.object({
  tronco: token, bracos: token, pernas: token, pele: token, sapato: token,
  /** largura do peito e do abdome [x, z] */
  peito: R2, abdome: R2,
  /** espessura dos membros */
  membro: pos,
  lados: z.number().int().min(3),
  cabeca: z.boolean().optional(),
}).strict();

const character = z.object({
  ...comment,
  id: z.string().regex(/^[a-z]+$/),
  nome: z.string().min(1),
  tipo: z.enum(["sobrevivente", "cacador"]),
  /** cor dominante (token) — a da classe ou do caçador; nunca muda com skin */
  cor: token,
  /** altura final em metros (Art Bible §3: sobreviventes 1,70–1,82; caçadores 2,40–2,50) */
  altura: pos,
  /** multiplicador do comprimento de braço e antebraço (Espectro: braços que passam do joelho) */
  bracos: pos.optional(),
  /** multiplicador do comprimento dos dedos (Espectro: dedos longos) */
  dedos: pos.optional(),
  /** mantém os ossos dos dedos (só quem tem dedos modelados) */
  manterDedos: z.boolean(),
  /** conjunto de clipes (chave de conjuntos_clipes) */
  clipes: z.string(),
  corpo: body,
  pecas: z.array(PieceSchema),
  /** 3 falanges × 5 dedos × 2 mãos, com os raios [base, ponta] de cada falange */
  dedosModelados: z.object({ ...comment, falanges: z.tuple([z.tuple([R2, R2]), z.tuple([R2, R2]), z.tuple([R2, R2])]), lados: z.number().int().min(3), cor: token, giro: num.optional() }).strict().optional(),
  /** onde a skin prende o acessório pequeno (posição relativa ao osso, mesma unidade das peças) */
  acessorio: z.object({ ...comment, osso: bone, desloc: V3 }).strict().optional(),
  /**
   * variantes de arte de uma parte da forma-chave, para o aprovador do marco escolher (A2-ajuste: cajado do
   * Curandeiro). As peças da variante `padrao` somam-se a `pecas` no bake; as outras só entram no orçamento
   * (validador) e nas capturas. Escolher = trocar `padrao` e rodar o bake.
   */
  variantes: z.object({
    ...comment,
    padrao: z.string().regex(/^[a-z_]+$/),
    lista: z.record(z.string().regex(/^[a-z_]+$/), z.object({ ...comment, nome: z.string().min(1), pecas: z.array(PieceSchema) }).strict()),
  }).strict().optional(),
}).strict();

const skin = z.object({
  ...comment,
  /** troca de cor: token secundário do corpo → token da skin */
  trocas: z.record(token, token),
  /** acessório pequeno (caixa) no ponto `acessorio` do personagem; tamanho em metros finais */
  acessorio: z.object({ tam: z.tuple([pos, pos, pos]), rot: V3.optional(), cor: token }).strict().nullable(),
}).strict();

export const SheetSchema = z.object({
  $comment: z.string().optional(),
  $comment_clipes: z.string().optional(),
  version: z.number().int().positive(),
  conjuntos_clipes: z.record(z.string(), clipSet),
  personagens: z.array(character).min(1),
  skins: z.object({
    ...comment,
    /** tokens que uma skin pode trocar (cores secundárias, Art Bible §3) */
    slots: z.array(token).min(1),
    lista: z.record(z.string(), skin),
  }).strict(),
}).strict();
export type Sheet = z.infer<typeof SheetSchema>;
export type SheetCharacter = Sheet["personagens"][number];
export type SheetPiece = z.infer<typeof PieceSchema>;
export type ClipRecipe = z.infer<typeof clipRecipe>;
export type SkinDef = z.infer<typeof skin>;

/** ids das variantes de um personagem (a padrão primeiro); sem `variantes`, uma só, sem nome */
export function variantIds(c: SheetCharacter): (string | undefined)[] {
  if (!c.variantes) return [undefined];
  return [c.variantes.padrao, ...Object.keys(c.variantes.lista).filter(v => v !== c.variantes!.padrao)];
}

/** tokens que nunca vão no corpo de um personagem: são cor de estado ou de foco (Art Bible §4, §8) */
export const FORBIDDEN_ON_BODY = ["ui.accent", "fx.preso", "fx.ameaca", "ui.danger"] as const;

/** resolve um conjunto de clipes (com herança por `base`) nos 9 clipes */
export function resolveClips(sheet: Sheet, name: string, seen: string[] = []): Record<ClipName, ClipRecipe> {
  const set = sheet.conjuntos_clipes[name];
  if (!set) throw new Error(`conjunto de clipes '${name}' inexistente`);
  if (seen.includes(name)) throw new Error(`conjunto de clipes '${name}' com herança circular`);
  const base = set.base ? resolveClips(sheet, set.base, [...seen, name]) : ({} as Record<ClipName, ClipRecipe>);
  const out = { ...base, ...set.clipes } as Record<ClipName, ClipRecipe>;
  const missing = CLIP_NAMES.filter(c => !out[c]);
  if (missing.length && !seen.length) throw new Error(`conjunto '${name}': faltam clipes ${missing.join(", ")}`);
  return out;
}

/** coerência entre a ficha, a paleta e as skins da economia; devolve a lista de erros (vazia = ok) */
export function checkArt(palette: PaletteData, sheet: Sheet, skinIds: string[]): string[] {
  const errs: string[] = [];
  const has = (t: string) => t in palette.tokens;
  const forbidden = new Set<string>(FORBIDDEN_ON_BODY);
  const slots = new Set(sheet.skins.slots);
  for (const name of Object.keys(sheet.conjuntos_clipes)) {
    try { resolveClips(sheet, name); } catch (e) { errs.push((e as Error).message); }
  }
  const ids = new Set<string>();
  for (const c of sheet.personagens) {
    if (ids.has(c.id)) errs.push(`personagem '${c.id}' repetido`);
    ids.add(c.id);
    if (!sheet.conjuntos_clipes[c.clipes]) errs.push(`${c.id}: conjunto de clipes '${c.clipes}' inexistente`);
    if (!/^(class|hunter)\./.test(c.cor)) errs.push(`${c.id}: cor dominante '${c.cor}' deve ser class.* ou hunter.*`);
    if (slots.has(c.cor)) errs.push(`${c.id}: a cor dominante não pode ser trocada por skin`);
    if (c.variantes && !c.variantes.lista[c.variantes.padrao]) errs.push(`${c.id}: variante padrão '${c.variantes.padrao}' fora de variantes.lista`);
    const variantPieces = Object.values(c.variantes?.lista ?? {}).flatMap(v => v.pecas);
    const used = [c.cor, ...Object.entries(c.corpo).filter(([k]) => ["tronco", "bracos", "pernas", "pele", "sapato"].includes(k)).map(([, v]) => v as string),
      ...c.pecas.map(p => p.cor), ...variantPieces.map(p => p.cor), ...(c.dedosModelados ? [c.dedosModelados.cor] : [])];
    for (const t of used) {
      if (!has(t)) errs.push(`${c.id}: cor '${t}' não é token de data/art/palette.json`);
      if (forbidden.has(t)) errs.push(`${c.id}: cor '${t}' é cor de estado/foco e não pode ir no corpo (Art Bible §4)`);
    }
    if (c.tipo === "sobrevivente" && !c.acessorio) errs.push(`${c.id}: sobrevivente sem ponto de acessório de skin`);
  }
  for (const t of sheet.skins.slots) if (!has(t)) errs.push(`skins.slots: '${t}' não é token`);
  for (const [id, s] of Object.entries(sheet.skins.lista)) {
    for (const [from, to] of Object.entries(s.trocas)) {
      if (!slots.has(from)) errs.push(`skin ${id}: '${from}' não é cor secundária trocável (skins.slots)`);
      if (!has(to)) errs.push(`skin ${id}: '${to}' não é token`);
      if (!to.startsWith("skin.")) errs.push(`skin ${id}: '${to}' deve ser token skin.*`);
    }
    if (s.acessorio && !has(s.acessorio.cor)) errs.push(`skin ${id}: acessório com cor '${s.acessorio.cor}' que não é token`);
    if (s.acessorio && !s.acessorio.cor.startsWith("skin.")) errs.push(`skin ${id}: acessório deve usar token skin.*`);
  }
  const listed = Object.keys(sheet.skins.lista).sort(), eco = [...skinIds].sort();
  if (listed.join() !== eco.join()) errs.push(`skins da ficha [${listed}] diferentes das skins de data/balance.yaml [${eco}]`);
  return errs;
}
