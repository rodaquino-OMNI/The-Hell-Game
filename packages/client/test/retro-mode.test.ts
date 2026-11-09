// V9 — modo "Retro FPS" (D-13, D-14, D-15 em docs/plano-construcao.md §7; respostas do A2b na issue #27): opção do
// menu persistida e caminho de depuração só com ?debug=1 (D-33), ferramenta menor e no canto (1b), luneta do Batedor
// feita em código dentro do teto de triângulos (2c, Art Bible §7), barra fina só com vida, fôlego e habilidade (3b),
// balanço zerado por "reduzir balanço de câmera" (GDD-v0.3 §12.4) e altura da barra para o layout de baixo.
import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { createGame } from "@thehell/sim";
import { balance, cfg } from "../src/data.ts";
import { statusBarLift } from "../src/hud/layout.ts";
import { statusBarHtml } from "../src/hud/statusbar.ts";
import { t } from "../src/i18n/index.ts";
import { setReduceCameraBob } from "../src/render/motion.ts";
import { parseRetroParams, RETRO_CLASSES, type RetroClass } from "../src/render/options.ts";
import { getRetroOption, retroMode, setRetroOption } from "../src/render/retro/mode.ts";
import { createViewmodel } from "../src/render/retro/viewmodel.ts";
import { defaultOptions, loadOptions, parseOptions, saveOptions } from "../src/ui/settings.ts";

const vmData = balance.render.retro.viewmodel;

/** posições (espaço da câmera da ferramenta) de todos os vértices das malhas da ferramenta */
function vertices(vm: ReturnType<typeof createViewmodel>): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  vm.scene.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const p = m.geometry.getAttribute("position");
    for (let i = 0; i < p.count; i++) out.push(new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)).add(m.parent!.position));
  });
  return out;
}

/** área (NDC²) da caixa projetada e distância média ao canto inferior mais próximo (NDC) */
function screenStats(cls: RetroClass, corner?: { scale: number; anchor: readonly number[] }) {
  const vm = createViewmodel(cls, 16 / 9, corner);
  vm.camera.updateMatrixWorld();
  const ndc = vertices(vm).map(v => v.project(vm.camera));
  const xs = ndc.map(v => v.x), ys = ndc.map(v => v.y);
  const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  const toCorner = ndc.reduce((s, v) => s + Math.hypot(1 - Math.abs(v.x), -1 - v.y), 0) / ndc.length;
  return { area, toCorner, triangles: vm.triangles, vm };
}

describe("opção do menu (ui/settings.ts retroFps)", () => {
  afterEach(() => setRetroOption(false));
  it("desligada por padrão (D-13: a 3ª pessoa continua padrão); valor inválido cai no padrão", () => {
    expect(defaultOptions().retroFps).toBe(false);
    expect(parseOptions({}).retroFps).toBe(false);
    expect(parseOptions({ retroFps: "sim" }).retroFps).toBe(false);
    expect(parseOptions({ retroFps: true }).retroFps).toBe(true);
  });
  it("persiste como as outras opções", () => {
    const m = new Map<string, string>();
    const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
    expect(saveOptions({ ...defaultOptions(), retroFps: true }, st)).toBe(true);
    expect(loadOptions(st).retroFps).toBe(true);
  });
  it("a opção liga o modo (retro/mode.ts)", () => {
    expect(retroMode()).toBe(false);
    setRetroOption(true);
    expect(getRetroOption()).toBe(true);
    expect(retroMode()).toBe(true);
  });
});

describe("caminho de depuração ?retro=1 (D-33)", () => {
  it("sem ?debug=1 nada liga, nem a classe da vista", () => {
    expect(parseRetroParams("?retro=1&retro_class=batedor")).toEqual({ retro: false, cls: undefined });
  });
  it("com ?debug=1 liga e aceita só classes conhecidas", () => {
    expect(parseRetroParams("?debug=1&retro=1&retro_class=batedor")).toEqual({ retro: true, cls: "batedor" });
    expect(parseRetroParams("?debug=1&retro=1&retro_class=pirata")).toEqual({ retro: true, cls: undefined });
    expect(parseRetroParams("?debug=1")).toEqual({ retro: false, cls: undefined });
  });
});

describe("ferramenta na mão (A2b 1b e 2c)", () => {
  it("cada classe fica dentro do teto de triângulos (Art Bible §7, render.retro.viewmodel.max_triangles)", () => {
    for (const cls of RETRO_CLASSES) {
      const n = createViewmodel(cls, 16 / 9).triangles;
      expect(n, cls).toBeGreaterThan(0);
      expect(n, cls).toBeLessThanOrEqual(vmData.max_triangles);
    }
  });
  it("1b: menor e mais perto do canto que a pose do mockup (escala 1)", () => {
    for (const cls of RETRO_CLASSES) {
      const now = screenStats(cls), mockup = screenStats(cls, { scale: 1, anchor: vmData.corner.anchor });
      expect(now.area, cls).toBeLessThan(mockup.area);
      expect(now.toCorner, cls).toBeLessThan(mockup.toCorner);
    }
  });
  it("2c: o Batedor leva a luneta (cilindros feitos em código), à direita e na metade de baixo da tela", () => {
    const g = vmData.classes.batedor!.grupos.find(x => "pecas" in x)!;
    expect("pecas" in g && g.pecas.length).toBeGreaterThan(0);
    const vm = createViewmodel("batedor", 16 / 9);
    const per = (lados: number) => 4 * lados - 4;                       // prisma: 2·lados laterais + 2·(lados − 2) tampas
    const pieces = "pecas" in g ? g.pecas.reduce((s, p) => s + (p.forma === "cilindro" ? per(p.lados) : 12), 0) : 0;
    expect(vm.triangles).toBeGreaterThanOrEqual(pieces);
    // o centro da luneta (ponto `pos` do grupo, depois do canto) cai à direita e embaixo
    const [ax, ay, az] = vmData.corner.anchor, k = vmData.corner.scale;
    const c = new THREE.Vector3(ax + (g.pos[0] - ax) * k, ay + (g.pos[1] - ay) * k, az + (g.pos[2] - az) * k);
    vm.camera.updateMatrixWorld();
    const p = c.project(vm.camera);
    expect(p.x).toBeGreaterThan(0);
    expect(p.y).toBeLessThan(0);
  });
});

describe("balanço com reduzir balanço de câmera (GDD-v0.3 §12.4)", () => {
  afterEach(() => setReduceCameraBob(false));
  const swing = (cls: RetroClass) => {
    const vm = createViewmodel(cls, 16 / 9);
    const tool = vm.scene.children.find(o => o.name.startsWith("ferramenta"))!;
    const run = balance.survivor.run, dt = 1 / 60;
    let max = 0;
    for (let i = 0; i <= 120; i++) { vm.update(i * dt * run, 0, i * dt, true); max = Math.max(max, tool.position.length()); }
    return max;
  };
  it("todas as classes balançam ao correr e ficam paradas com a opção (ui.options.reduced_bob = 0)", () => {
    expect(balance.ui.options.reduced_bob).toBe(0);
    for (const cls of RETRO_CLASSES) {
      setReduceCameraBob(false);
      expect(swing(cls), cls).toBeGreaterThan(0);
      setReduceCameraBob(true);
      expect(swing(cls), cls).toBe(0);
    }
  });
});

describe("barra de estado fina (A2b 3b)", () => {
  const G = createGame(cfg, "Mecânico", 3);
  it("só três blocos: vida, fôlego e habilidade (com a tecla atual e o ícone da classe)", () => {
    const html = statusBarHtml(G, undefined, "Q");
    expect(html.match(/class="sbs/g)?.length).toBe(3);
    expect(html).toContain(t("retro.health"));
    expect(html).toContain(t("retro.stamina"));
    expect(html).toContain(t("retro.ability", { key: "Q" }));
    expect(html.match(/role="meter"/g)?.length).toBe(2);
    expect(html).toContain('role="img"');
    // nada de geradores, caçador nem equipe na barra (seguem no HUD padrão)
    expect(html).not.toContain('class="pt');
  });
  it("tecla remapeada aparece no rótulo da habilidade", () => {
    expect(statusBarHtml(G, undefined, "F")).toContain(t("retro.ability", { key: "F" }));
  });
  it("vista de depuração do Batedor (fase 4) usa nome e ícone próprios", () => {
    expect(statusBarHtml(G, "batedor", "Q")).toContain(`aria-label="${t("class.scout")}"`);
  });
});

describe("altura da barra para o layout de baixo (hud/layout.ts)", () => {
  it("--sb-h = do pé da tela ao topo da barra; 0 escondida", () => {
    expect(statusBarLift({ hidden: false, top: 680 }, 720)).toBe(40);
    expect(statusBarLift({ hidden: true, top: 0 }, 720)).toBe(0);
  });
});
