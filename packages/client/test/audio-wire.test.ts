// Ligação do áudio no laço (V5): o estado da música que o gancho de depuração do diretor expõe, antes de a música
// existir, e a flag lida pelo laço (main.ts e hud/hud.ts calam os bipes antigos com ela).
import { describe, expect, it } from "vitest";
import { directorEnabled } from "../src/audio/director.ts";
import { musicInfo } from "../src/audio/music.ts";
import { balance } from "../src/data.ts";

describe("ligação do áudio", () => {
  it("musicInfo sem música criada: sem estado e sem tocar", () => {
    expect(musicInfo()).toEqual({ state: null, playing: false });
  });
  it("directorEnabled lê audio.director_enabled", () => {
    expect(directorEnabled()).toBe(balance.audio.director_enabled);
  });
});
