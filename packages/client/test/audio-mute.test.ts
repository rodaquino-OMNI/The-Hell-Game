// Mudo do master na tecla M (D-41): alterna 0 ↔ volume anterior, grava o anterior e só reage à tecla certa.
import { describe, expect, it } from "vitest";
import { createMuteToggle, installMuteKey, MUTE_KEY, UNMUTE_STORAGE_KEY } from "../src/audio/mute.ts";
import { balance } from "../src/data.ts";
import type { VolumeName } from "../src/audio/engine.ts";

function rig(master: number, stored: Record<string, string> = {}) {
  const vol: Record<string, number> = { master };
  const store = { ...stored };
  const storage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } };
  const toggle = createMuteToggle({ get: (b: VolumeName) => vol[b], set: (b: VolumeName, v: number) => (vol[b] = v), storage });
  return { vol, store, toggle };
}

describe("audio/mute (D-41)", () => {
  it("M duas vezes: muda para 0 e volta ao volume de antes", () => {
    const r = rig(0.7);
    expect(r.toggle.muted()).toBe(false);
    expect(r.toggle.toggle()).toBe(true);
    expect(r.vol.master).toBe(0);
    expect(r.store[UNMUTE_STORAGE_KEY]).toBe("0.7");
    expect(r.toggle.toggle()).toBe(false);
    expect(r.vol.master).toBe(0.7);
  });

  it("já mudo ao abrir (recarga): volta ao volume gravado; sem gravação válida, ao padrão audio.buses.master", () => {
    expect((() => { const r = rig(0, { [UNMUTE_STORAGE_KEY]: "0.4" }); r.toggle.toggle(); return r.vol.master; })()).toBe(0.4);
    for (const bad of [undefined, "0", "abc", "2"]) {
      const r = rig(0, bad === undefined ? {} : { [UNMUTE_STORAGE_KEY]: bad });
      expect(r.toggle.toggle()).toBe(false);
      expect(r.vol.master).toBe(balance.audio.buses.master);
    }
  });

  it("installMuteKey: só KeyM sem repetição, sem modificador e fora de campo de texto", () => {
    const r = rig(1);
    const target = new EventTarget();
    const seen: boolean[] = [];
    const off = installMuteKey(target, m => seen.push(m), r.toggle);
    const key = (init: Partial<KeyboardEvent> & { tagName?: string }) => {
      const e = Object.assign(new Event("keydown"), { code: MUTE_KEY, repeat: false, ctrlKey: false, metaKey: false, altKey: false, ...init });
      if (init.tagName) Object.defineProperty(e, "target", { value: { tagName: init.tagName } });
      target.dispatchEvent(e);
    };
    key({ code: "KeyV" });
    key({ repeat: true });
    key({ ctrlKey: true });
    key({ tagName: "INPUT" });
    expect(seen).toEqual([]);
    key({});
    key({});
    expect(seen).toEqual([true, false]);
    off();
    key({});
    expect(seen).toEqual([true, false]);
  });
});
