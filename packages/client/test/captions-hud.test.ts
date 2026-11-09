// V8b: faixa de legendas de som no HUD (GDD-v0.3 §12.4, §11 L218): seta pelo setor (o mesmo da seta de ameaça),
// ×N das fusões, direção também em texto, borda de perigo nas categorias do caçador, esmaecer em degraus e sem
// esmaecer com "reduzir flicker"; setor no módulo neutro geom/sector.ts.
import { describe, expect, it } from "vitest";
import { createCaptionBus, type Caption } from "../src/audio/captions.ts";
import { balance } from "../src/data.ts";
import { relativeSector } from "../src/geom/sector.ts";
import { relativeSector as fromThreat } from "../src/hud/threat.ts";
import { setLocale } from "../src/i18n/index.ts";
import { captionHtml, captionOpacity, fadeWrites, liveFor } from "../src/hud/captions.ts";
import { captionDuration, captionsEnabled, setCaptionDuration, setCaptionsEnabled } from "../src/audio/captions.ts";
import { getBusVolume, setBusVolume } from "../src/audio/engine.ts";
import { resetOwnedDefaults } from "../src/ui/options.ts";

const cu = balance.ui.captions;
const cap = (o: Partial<Caption>): Caption => ({ id: 1, key: "caption.hunter_steps", category: "hunter_steps", text: "Passos pesados: o caçador", dir: 2, intensity: 1, t: 0, ttl: 3, count: 1, priority: 1, ...o });

describe("faixa de legendas", () => {
  it("setor vem de geom/sector.ts (a seta de ameaça reexporta a mesma função)", () => {
    expect(fromThreat).toBe(relativeSector);
  });

  it("seta girada pelo setor, direção em texto para leitor de tela, ×N só com fusão", () => {
    setLocale("pt-BR");
    const h = captionHtml(cap({ dir: 2, count: 3 }));
    expect(h).toContain(`rotate(${(2 * 360) / balance.ui.threat_sectors}deg)`);
    expect(h).toContain('class="sr"');
    expect(h).toContain("×3");
    expect(h).toContain('class="cp hz"');
    const n = captionHtml(cap({ dir: null, count: 1, category: "survivor", key: "caption.rescue", text: "Acorde" }));
    expect(n).not.toContain("rotate(");
    expect(n).not.toContain('class="sr"');
    expect(n).not.toContain("×");
    expect(n).toContain('class="cp"');
  });

  it("texto é escapado (o HTML vem do i18n, mas não confia)", () => {
    expect(captionHtml(cap({ text: "<b>&" }))).toContain("&#60;b&#62;&#38;");
  });

  it("esmaece só nos últimos ui.captions.fade s, em ui.captions.opacity_steps degraus; reduzir flicker não esmaece", () => {
    expect(captionOpacity(cu.fade * 2, cu.fade, cu.opacity_steps, false)).toBe(1);
    const seen = new Set<number>();
    for (let ttl = cu.fade; ttl > 0; ttl -= 0.001) seen.add(captionOpacity(ttl, cu.fade, cu.opacity_steps, false));
    expect(seen.size).toBeLessThanOrEqual(cu.opacity_steps);
    expect(Math.min(...seen)).toBeGreaterThan(0);
    expect(captionOpacity(cu.fade / 3, cu.fade, cu.opacity_steps, true)).toBe(1);
  });

  it("fusão do barramento vira ×N com a direção nova", () => {
    const bus = createCaptionBus({ storage: null, translate: k => k });
    const ear = { x: 0, z: 0 };
    bus.emit({ name: "step_hunter", pos: { x: 5, z: 0 }, ear, yaw: 0 });
    bus.emit({ name: "step_hunter", pos: { x: 5, z: 0.1 }, ear, yaw: 0 });
    const [c] = bus.list();
    expect(c.count).toBe(2);
    expect(captionHtml(c)).toContain("×2");
  });
});

describe("faixa de legendas: aria-live, escritas de esmaecer e restaurar padrões", () => {
  it("aria-live off na partida e polite fora dela", () => {
    expect(liveFor(true)).toBe("off");
    expect(liveFor(false)).toBe("polite");
  });

  it("só escreve quando o degrau muda; com reduzir flicker nunca esmaece", () => {
    const shown = new Map<number, number>();
    const a = { id: 1, ttl: cu.fade * 4 }, b = { id: 2, ttl: cu.fade / 2 };
    expect(fadeWrites([a, b], shown, false)).toEqual([{ id: 1, opacity: 1 }, { id: 2, opacity: captionOpacity(b.ttl, cu.fade, cu.opacity_steps, false) }]);
    expect(fadeWrites([a, b], shown, false)).toEqual([]); // nada mudou: nenhuma escrita
    const step = cu.fade / cu.opacity_steps;
    expect(fadeWrites([a, { id: 2, ttl: b.ttl - step }], shown, false).map(w => w.id)).toEqual([2]);
    // ao longo de todo o esmaecer, no máximo opacity_steps escritas
    const seen = new Map<number, number>();
    let n = 0;
    for (let ttl = cu.fade; ttl > 0; ttl -= 0.001) n += fadeWrites([{ id: 9, ttl }], seen, false).length;
    expect(n).toBeLessThanOrEqual(cu.opacity_steps);
    expect(fadeWrites([{ id: 3, ttl: 0.01 }], new Map(), true)).toEqual([{ id: 3, opacity: 1 }]);
  });

  it("o HTML já sai com o degrau atual (sem depender do próximo quadro)", () => {
    expect(captionHtml(cap({}), 0.4)).toContain('style="opacity:0.4"');
    expect(captionHtml(cap({}), 1)).not.toContain("opacity");
  });

  it("restaurar padrões volta legendas (ligadas, tempo padrão) e volumes", () => {
    const ac = balance.audio.captions;
    setCaptionsEnabled(!ac.enabled_default);
    setCaptionDuration(ac.durations.at(-1)!);
    setBusVolume("music", 0);
    resetOwnedDefaults();
    expect(captionsEnabled()).toBe(ac.enabled_default);
    expect(captionDuration()).toBe(ac.durations[ac.default_duration_index]);
    expect(getBusVolume("music")).toBe(balance.audio.buses.music);
  });
});
