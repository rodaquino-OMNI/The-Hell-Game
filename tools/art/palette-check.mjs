#!/usr/bin/env node
// Verificador da paleta (Art Bible §2 e §5): contraste WCAG 2.2 e distinção sob daltonismo simulado.
// Cada teste roda sobre as cores exatas dos tokens e sobre as cores que saem do passe final do jogo
// (dither Bayer 4×4 + quantização para render.ps1.color_bits por canal, packages/client/src/render/present.ts):
// cada token vira até 16 variantes (uma por limiar da matriz de Bayer) e vale o pior par de variantes.
// Uso: node tools/art/palette-check.mjs [data/art/palette.json] [--md]
// Sai com código 1 se algum teste falhar (pronto para virar etapa da CI na fase 0).
//
// Referências:
//  - Luminância relativa e razão de contraste: WCAG 2.2, definições "relative luminance" e "contrast ratio"
//    https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
//  - Simulação de deficiência de cor: Machado, Oliveira & Fernandes (2009), "A Physiologically-based Model for
//    Simulation of Color Vision Deficiency", IEEE TVCG 15(6) — matrizes de severidade 1,0, aplicadas em RGB linear.
//  - Diferença de cor: CIEDE2000 (Sharma, Wu & Dalal, 2005, "The CIEDE2000 Color-Difference Formula").
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith("--")) ?? "data/art/palette.json";
const asMd = args.includes("--md");
const pal = JSON.parse(readFileSync(file, "utf8"));
// GDD-v0.3 §10.1 item 4: quantização para color_bits por canal (data/balance.yaml render.ps1)
const bits = parse(readFileSync(new URL("../../data/balance.yaml", import.meta.url), "utf8"))?.render?.ps1?.color_bits;
if (!Number.isInteger(bits)) throw new Error("data/balance.yaml sem render.ps1.color_bits");

const to8 = v => Math.round((v * 255) / 31);
const hex = c => "#" + c.map(v => v.toString(16).padStart(2, "0")).join("").toUpperCase();
const color = name => {
  const t = pal.tokens[name];
  if (!t) throw new Error(`token inexistente: ${name}`);
  return t.rgb5.map(to8);
};

// Passe final (present.ts): q = floor(c·níveis + limiar) / níveis, limiar = (Bayer[k] + 0,5) / 16, níveis = 2^bits − 1.
// A cor do token chega ao passe em 8 bits (alvo RGBA8); a saída volta a 8 bits na tela.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const levels = 2 ** bits - 1;
const quantize = (rgb, k) => rgb.map(v => Math.round(Math.min(1, Math.max(0, Math.floor((v / 255) * levels + (BAYER[k] + 0.5) / 16) / levels)) * 255));
/** as 16 cores (uma por posição da matriz 4×4) que uma área chapada do token vira na tela */
const pattern = name => BAYER.map((_, k) => quantize(color(name), k));
/** variantes distintas do padrão (pior pixel) */
const variants = name => [...new Map(pattern(name).map(q => [q.join(","), q])).values()];
/**
 * Modos de cor de um token. Portões: "exata" e "média 4×4" (a cor percebida da área com dither: média do padrão
 * em luz linear, como o olho integra o Bayer). "pior pixel" (a variante mais desfavorável, pixel isolado) é
 * informativo: sai como aviso, não como falha.
 */
const MODES = [
  { name: "exata", gate: true, get: n => [color(n)] },
  { name: "média 4×4", gate: true, get: n => { const p = pattern(n); return [[0, 1, 2].map(c => unlin(p.reduce((s, q) => s + lin(q[c]), 0) / p.length))]; } },
  { name: "pior pixel", gate: false, get: variants },
];

// sRGB <-> linear
const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const unlin = c => { c = Math.min(1, Math.max(0, c)); return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055); };

// WCAG: luminância com o limiar 0.04045 (a errata atual da WCAG 2.x usa 0.04045 em vez de 0.03928; diferença irrelevante em 8 bits)
const lum = rgb => { const [r, g, b] = rgb.map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// Machado et al. 2009, severidade 1,0
const CVD = {
  protanopia:   [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritanopia:   [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
const simulate = (rgb, m) => {
  const l = rgb.map(lin);
  return m.map(row => unlin(row[0] * l[0] + row[1] * l[1] + row[2] * l[2]));
};

// sRGB -> CIELAB (D65)
const lab = rgb => {
  const [r, g, b] = rgb.map(lin);
  let x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  let y = (0.2126729 * r + 0.7151522 * g + 0.0721750 * b) / 1.0;
  let z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
  const f = t => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  [x, y, z] = [f(x), f(y), f(z)];
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
};

// CIEDE2000
const de2000 = (c1, c2) => {
  const [L1, a1, b1] = lab(c1), [L2, a2, b2] = lab(c2);
  const rad = d => (d * Math.PI) / 180, deg = r => (r * 180) / Math.PI;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h = (b, a) => { if (a === 0 && b === 0) return 0; const v = deg(Math.atan2(b, a)); return v >= 0 ? v : v + 360; };
  const h1p = h(b1, a1p), h2p = h(b2, a2p);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp / 2));
  const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) { if (Math.abs(h1p - h2p) > 180) hbp += h1p + h2p < 360 ? 360 : -360; hbp /= 2; }
  const T = 1 - 0.17 * Math.cos(rad(hbp - 30)) + 0.24 * Math.cos(rad(2 * hbp)) + 0.32 * Math.cos(rad(3 * hbp + 6)) - 0.20 * Math.cos(rad(4 * hbp - 63));
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const RC = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const SC = 1 + 0.045 * Cbp, SH = 1 + 0.015 * Cbp * T;
  const RT = -Math.sin(rad(2 * dTheta)) * RC;
  return Math.sqrt((dLp / SL) ** 2 + (dCp / SC) ** 2 + (dHp / SH) ** 2 + RT * (dCp / SC) * (dHp / SH));
};

// ---------- testes ----------
const fails = [];
const out = [];
const t = pal.tests;
const tokens = Object.entries(pal.tokens);

out.push(`Quantização do passe final: ${bits} bits por canal (render.ps1.color_bits), dither Bayer 4×4. Portões: cor exata e média do padrão 4×4 (cor percebida); "pior pixel" é aviso.\n`);
out.push("## Tokens (15 bits → hex)\n", "| Token | RGB 5 bits | Hex | Variantes após o passe final | Uso |", "| --- | --- | --- | --- | --- |");
for (const [k, v] of tokens) out.push(`| \`${k}\` | ${v.rgb5.join(", ")} | ${hex(color(k))} | ${variants(k).length} | ${v.uso ?? ""} |`);
const warns = [];

/** pior razão de contraste entre as cores de `a` e `b` no modo dado */
const worstContrast = (a, b, get) => Math.min(...get(a).flatMap(x => get(b).map(y => contrast(x, y))));

function contrastTable(title, test, kind) {
  out.push(`\n## ${title} (mínimo ${test.min}:1)\n`, `| Elemento | Fundo | ${MODES.map(m => m.name).join(" | ")} | Resultado |`, "| --- | --- | --- | --- | --- | --- |");
  for (const [a, b] of test.pairs) {
    const r = MODES.map(m => worstContrast(a, b, m.get));
    let ok = true, warn = false;
    MODES.forEach((m, i) => {
      if (r[i] >= test.min) return;
      const msg = `${kind} ${a} sobre ${b} (${m.name}): ${r[i].toFixed(2)}`;
      if (m.gate) { ok = false; fails.push(msg); } else { warn = true; warns.push(msg); }
    });
    out.push(`| \`${a}\` | \`${b}\` | ${r.map(x => x.toFixed(2) + ":1").join(" | ")} | ${ok ? (warn ? "passa (aviso)" : "passa") : "FALHA"} |`);
  }
}
contrastTable("Contraste de texto (WCAG 2.2 1.4.3)", t.contrast_text, "contraste texto");
contrastTable("Contraste de elementos gráficos (WCAG 2.2 1.4.11)", t.contrast_nontext, "contraste gráfico");
if (t.contrast_state) contrastTable("Mudança de estado por brilho (Art Bible §1.5 e §4)", t.contrast_state, "contraste de estado");

/** menor CIEDE2000 entre as cores de `a` e `b` sob a simulação `m` (null = visão normal) no modo `get` */
const worstDe = (a, b, m, get) => {
  let d = Infinity;
  for (const x of get(a)) for (const y of get(b)) d = Math.min(d, de2000(m ? simulate(x, m) : x, m ? simulate(y, m) : y));
  return d;
};
const VISION = [["normal", null], ...Object.entries(CVD)];

/** `groups`: [nome, pares, visões?]; vale o pior par em cada visão (todas, ou só `visões`) e em cada modo de portão */
function deTable(title, min, groups) {
  out.push(`\n## ${title} (CIEDE2000, mínimo ${min})\n`);
  out.push(`Menor diferença entre dois membros, em visão normal e sob cada simulação (Machado 2009, severidade 1,0); cada célula: ${MODES.map(m => m.name).join(" / ")}.\n`);
  out.push("| Grupo | Normal | Protanopia | Deuteranopia | Tritanopia | Par mais próximo (pior caso) | Resultado |", "| --- | --- | --- | --- | --- | --- | --- |");
  for (const [g, pairs, only] of groups) {
    const row = []; let worst = { d: Infinity }, worstInfo = { d: Infinity };
    for (const [mode, m] of VISION) {
      if (only && !only.includes(mode)) { row.push("—"); continue; }
      const cell = [];
      for (const qm of MODES) {
        let best = { d: Infinity };
        for (const [a, b] of pairs) { const d = worstDe(a, b, m, qm.get); if (d < best.d) best = { d, pair: `${a} × ${b}`, mode: `${mode}, ${qm.name}` }; }
        cell.push(best.d.toFixed(1));
        if (qm.gate && best.d < worst.d) worst = best;
        if (!qm.gate && best.d < worstInfo.d) worstInfo = best;
      }
      row.push(cell.join(" / "));
    }
    const ok = worst.d >= min, warn = worstInfo.d < min;
    if (!ok) fails.push(`grupo ${g}: ${worst.pair} em ${worst.mode} com ΔE00 ${worst.d.toFixed(1)}`);
    if (warn) warns.push(`grupo ${g}: ${worstInfo.pair} em ${worstInfo.mode} com ΔE00 ${worstInfo.d.toFixed(1)}`);
    out.push(`| ${g} | ${row.join(" | ")} | ${worst.pair.replace(/\b(class|gen|hunter)\./g, "")} (${worst.mode}) | ${ok ? (warn ? "passa (aviso)" : "passa") : "FALHA"} |`);
  }
}
const allPairs = names => names.flatMap((a, i) => names.slice(i + 1).map(b => [a, b]));
deTable("Distinção entre cores do mesmo grupo", t.cvd_groups.min_de2000,
  Object.entries(t.cvd_groups).filter(([, v]) => Array.isArray(v)).map(([g, names]) => [g, allPairs(names)]));
if (t.distinct) {
  // "prefixo.*" expande para todos os tokens com o prefixo
  const expand = list => list.flatMap(p => (p.endsWith(".*") ? tokens.map(([k]) => k).filter(k => k.startsWith(p.slice(0, -1))) : [p]));
  deTable("Cores que não podem ser confundidas com estado nem com cor dominante", t.distinct.min_de2000,
    Object.entries(t.distinct).filter(([, v]) => v && typeof v === "object" && v.tokens).map(([g, v]) => {
      const a = expand(v.tokens), b = expand(v.contra);
      for (const n of [...a, ...b]) color(n);
      return [g, a.flatMap(x => b.map(y => [x, y])), v.visoes];
    }));
}

if (warns.length) out.push(`\n**Avisos (pior pixel, informativo):** ${warns.length}\n\n- ` + warns.join("\n- "));
out.push(`\n**Resultado:** ${fails.length === 0 ? "todos os testes passam." : `${fails.length} falha(s):\n\n- ` + fails.join("\n- ")}`);

if (asMd) console.log(out.join("\n"));
else { console.log(out.filter(l => !l.startsWith("|") || l.includes("FALHA")).join("\n")); }
process.exit(fails.length ? 1 : 0);
