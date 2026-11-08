#!/usr/bin/env node
// Folha de silhuetas-conceito (Art Bible §3): gera docs/art/silhuetas-conceito.svg a partir de data/art/palette.json.
// Linha 1: preto chapado (teste de silhueta). Linha 2: mesma forma na cor do token. Escala: 1 m = 110 px.
// É rascunho de proporção e forma para aprovação (marco de arte 1), não arte final.
import { readFileSync, writeFileSync } from "node:fs";

const pal = JSON.parse(readFileSync("data/art/palette.json", "utf8")).tokens;
const hex = k => "#" + pal[k].rgb5.map(v => Math.round((v * 255) / 31).toString(16).padStart(2, "0")).join("");
const M = 110; // px por metro

// Cada figura é desenhada com origem nos pés (x=0, y=0) e y para cima negativo.
const humano = ({ h = 1.75, ombro = 0.46, quadril = 0.34, cabeca = 0.24 }) => {
  const H = h * M, hw = (ombro * M) / 2, qw = (quadril * M) / 2, r = (cabeca * M) / 2;
  const pescoco = H - 2 * r;
  return `
    <circle cx="0" cy="${-H + r}" r="${r}"/>
    <path d="M${-hw},${-pescoco + 6} L${hw},${-pescoco + 6} L${qw},${-H * 0.47} L${-qw},${-H * 0.47} Z"/>
    <path d="M${-qw},${-H * 0.48} L${-4},${-H * 0.48} L${-6},0 L${-qw - 4},0 Z"/>
    <path d="M${4},${-H * 0.48} L${qw},${-H * 0.48} L${qw + 4},0 L${6},0 Z"/>
    <path d="M${-hw},${-pescoco + 6} L${-hw - 12},${-H * 0.42} L${-hw - 3},${-H * 0.41} L${-hw + 6},${-pescoco + 20} Z"/>
    <path d="M${hw},${-pescoco + 6} L${hw + 12},${-H * 0.42} L${hw + 3},${-H * 0.41} L${hw - 6},${-pescoco + 20} Z"/>`;
};

const figuras = [
  { nome: "Curandeiro", token: "class.curandeiro", alt: 1.7, svg: () => humano({ h: 1.7, ombro: 0.42, quadril: 0.44 }) + `
      <path d="M-34,-178 Q0,-214 34,-178 L30,-150 L-30,-150 Z"/>
      <path d="M-30,-102 L30,-102 L44,-60 L-44,-60 Z"/>
      <rect x="30" y="-236" width="5" height="236"/>
      <path d="M32,-236 L12,-250 L22,-236 L12,-226 Z M33,-236 L53,-250 L43,-236 L53,-226 Z"/>
      <circle cx="32" cy="-243" r="6"/>` },
  { nome: "Mecânico", token: "class.mecanico", alt: 1.75, svg: () => humano({ h: 1.75, ombro: 0.5 }) + `
      <path d="M-18,-200 L18,-200 L22,-178 L-22,-178 Z"/>
      <rect x="-6" y="-210" width="12" height="10"/>
      <rect x="36" y="-130" width="10" height="84" transform="rotate(-20 40 -85)"/>
      <path d="M30,-148 a20,20 0 1,1 26,0 l-7,-12 h-12 Z" transform="rotate(-20 40 -85)"/>` },
  { nome: "Atacador", token: "class.atacador", alt: 1.78, svg: () => `
      <g transform="rotate(32 0 -150)">
        <rect x="-4" y="-246" width="8" height="160"/>
        <rect x="-17" y="-214" width="34" height="7"/>
        <rect x="-3" y="-240" width="6" height="26"/>
        <circle cx="0" cy="-246" r="6"/>
      </g>` + humano({ h: 1.78, ombro: 0.5 }) },
  { nome: "Batedor", token: "class.batedor", alt: 1.72, svg: () => humano({ h: 1.72, ombro: 0.38, quadril: 0.3, cabeca: 0.22 }) + `
      <path d="M-14,-160 L14,-160 L-36,-150 Q-52,-158 -62,-140 Q-46,-142 -34,-136 L-12,-146 Z"/>
      <path d="M-10,-186 L10,-186 L0,-206 Z"/>` },
  { nome: "Protetor", token: "class.protetor", alt: 1.82, svg: () => humano({ h: 1.82, ombro: 0.6, quadril: 0.46, cabeca: 0.25 }) + `
      <path d="M-16,-200 L16,-200 L16,-188 L-16,-188 Z"/>
      <circle cx="-50" cy="-104" r="32"/>` },
  { nome: "Espectro", token: "hunter.espectro", alt: 2.5, cacador: true, svg: () => `
      <ellipse cx="0" cy="-252" rx="14" ry="26"/>
      <path d="M-30,-226 L30,-226 L20,-120 L-20,-120 Z"/>
      <path d="M-18,-122 L-4,-122 L-10,0 L-24,0 Z M4,-122 L18,-122 L24,0 L10,0 Z"/>
      <path d="M-30,-226 L-46,-120 L-58,-70 L-50,-68 L-38,-118 L-24,-200 Z"/>
      <path d="M30,-226 L46,-120 L58,-70 L50,-68 L38,-118 L24,-200 Z"/>
      <path d="M-58,-70 l-6,14 M-54,-68 l-2,15 M-50,-68 l3,14" stroke="currentColor" stroke-width="3"/>
      <path d="M58,-70 l6,14 M54,-68 l2,15 M50,-68 l-3,14" stroke="currentColor" stroke-width="3"/>` },
  { nome: "O Carcereiro", token: "hunter.carcereiro", alt: 2.4, cacador: true, svg: () => `
      <rect x="-26" y="-264" width="52" height="46"/>
      <path d="M-26,-264 L-26,-276 M-13,-264 L-13,-276 M0,-264 L0,-276 M13,-264 L13,-276 M26,-264 L26,-276" stroke="currentColor" stroke-width="4"/>
      <path d="M-56,-216 L56,-216 L40,-110 L-40,-110 Z"/>
      <path d="M-40,-112 L-6,-112 L-10,0 L-44,0 Z M6,-112 L40,-112 L44,0 L10,0 Z"/>
      <path d="M-56,-216 L-72,-110 L-60,-108 L-46,-190 Z M56,-216 L72,-110 L60,-108 L46,-190 Z"/>
      <path d="M-66,-108 L-66,-40 M66,-108 L66,-50" stroke="currentColor" stroke-width="5" stroke-dasharray="7 3"/>
      <circle cx="-66" cy="-34" r="9"/><circle cx="66" cy="-44" r="9"/>` },
  { nome: "O Lamento", token: "hunter.lamento", alt: 2.45, cacador: true, svg: () => `
      <ellipse cx="14" cy="-248" rx="17" ry="22" transform="rotate(25 14 -248)"/>
      <path d="M-4,-262 Q30,-276 40,-240 Q46,-160 62,-40 Q70,-10 50,0 L30,-14 L18,0 L2,-16 L-12,0 L-26,-14 L-46,0 Q-62,-10 -52,-40 Q-34,-150 -24,-226 Q-20,-256 -4,-262 Z"/>
      <path d="M-24,-200 Q-60,-150 -66,-110 L-58,-108 Q-50,-140 -22,-170 Z"/>` },
];

const W = 150, X0 = 90, CHAO1 = 330, CHAO2 = 660, LARG = X0 + W * figuras.length;
const olhos = (f, chao) => f.cacador
  ? `<g fill="${hex("hunter.olhos")}"><circle cx="${f.nome === "O Lamento" ? 8 : -6}" cy="${chao - (f.nome === "O Carcereiro" ? 240 : f.nome === "O Lamento" ? 250 : 256)}" r="3"/><circle cx="${f.nome === "O Lamento" ? 20 : 6}" cy="${chao - (f.nome === "O Carcereiro" ? 240 : f.nome === "O Lamento" ? 246 : 256)}" r="3"/></g>` : "";

let corpo = "";
figuras.forEach((f, i) => {
  const x = X0 + i * W;
  corpo += `<g transform="translate(${x},${CHAO1})" fill="#000" color="#000">${f.svg()}</g>`;
  corpo += `<g transform="translate(${x},${CHAO2})" fill="${hex(f.token)}" color="${hex(f.token)}">${f.svg()}</g>`;
  corpo += `<g transform="translate(${x},0)">${olhos(f, CHAO2)}</g>`;
  corpo += `<text x="${x}" y="${CHAO1 + 26}" text-anchor="middle" class="n">${f.nome}</text>`;
  corpo += `<text x="${x}" y="${CHAO2 + 26}" text-anchor="middle" class="t">${hex(f.token).toUpperCase()} · ${f.alt.toFixed(2).replace(".", ",")} m</text>`;
});

const reguas = [0.5, 1, 1.5, 2, 2.5].map(m => `<line x1="40" x2="${LARG - 20}" y1="${CHAO1 - m * M}" y2="${CHAO1 - m * M}" class="r"/><text x="36" y="${CHAO1 - m * M + 4}" text-anchor="end" class="t">${String(m).replace(".", ",")} m</text>`).join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${LARG}" height="${CHAO2 + 50}" viewBox="0 0 ${LARG} ${CHAO2 + 50}">
<style>.n{font:600 14px monospace;fill:#111}.t{font:11px monospace;fill:#555}.r{stroke:#ccc;stroke-width:1;stroke-dasharray:3 4}.h{font:700 15px monospace;fill:#111}</style>
<rect width="100%" height="100%" fill="#f4f1ea"/>
<text x="20" y="24" class="h">THE HELL — silhuetas-conceito v0.3 · revisão 2 (pedidos do marco de arte A1)</text>
<text x="20" y="44" class="t">Linha 1: preto chapado — cada figura deve ser reconhecida em menos de 1 s. Linha 2: cor do token (data/art/palette.json) sobre o fundo de névoa.</text>
${reguas}
<line x1="40" x2="${LARG - 20}" y1="${CHAO1}" y2="${CHAO1}" stroke="#888"/>
<rect x="0" y="${CHAO1 + 40}" width="${LARG}" height="${CHAO2 - CHAO1 + 10}" fill="${hex("world.fog")}"/>
<line x1="40" x2="${LARG - 20}" y1="${CHAO2}" y2="${CHAO2}" stroke="${hex("world.wall")}"/>
<style>.f .t{fill:#aaa}</style>
<g class="f">${corpo}</g>
</svg>`;
writeFileSync("docs/art/silhuetas-conceito.svg", svg);
console.log("ok: docs/art/silhuetas-conceito.svg");
