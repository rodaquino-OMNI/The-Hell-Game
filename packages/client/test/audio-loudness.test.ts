// Loudness e créditos (item A-7 do V5; GDD-v0.3 §11, linha "Mixagem"): tools/audio/loudness.mjs.
// Créditos: com lista de arquivos injetada (sem ffmpeg) e no repositório real. Loudness: MP3 sintéticos gerados pelo
// ffmpeg num diretório temporário com a mesma estrutura de public/ (audio/music/...), medidos com ebur128. Sem ffmpeg:
// na CI (process.env.CI) o teste FALHA (o passo "Áudio: ffmpeg para os testes de stems" do ci.yml instala); fora da CI
// o bloco é pulado com aviso, no padrão de audio-stems.test.ts.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { hasBinaries } from "../../../tools/audio/ebur128.mjs";
import { checkCredits, judgeLoudness, listFiles, loadCfg, parseCsv, runLoudness } from "../../../tools/audio/loudness.mjs";

const root = new URL("../../../", import.meta.url).pathname;
const { cfg, licenses } = loadCfg(root + "data/balance.yaml");
const publicDir = root + "packages/client/public/";
const realCsv = readFileSync(publicDir + "media/creditos.csv", "utf8");
const HEADER = "arquivo,autor,fonte_url,licenca,licenca_url,data_conferencia,alteracoes";
const line = (arquivo: string, licenca = "CC0 1.0") =>
  `${arquivo},"Autor, com vírgula",https://exemplo.org/x,${licenca},https://creativecommons.org/publicdomain/zero/1.0/,2026-11-09,""`;
/** folga do teste: geração e medição pelo ffmpeg em máquina carregada (ms) */
const TIMEOUT = 60_000;

const hasFfmpeg = hasBinaries(["ffmpeg"]);
const inCI = !!process.env.CI;
if (!hasFfmpeg && !inCI) console.warn("audio-loudness: ffmpeg ausente no PATH; testes de loudness PULADOS (fora da CI)");

describe("créditos de áudio (A-7)", () => {
  it("o creditos.csv do repositório cobre todo arquivo de public/audio, sem órfão", () => {
    const files = listFiles(publicDir);
    expect(files.length).toBeGreaterThan(0);
    expect(checkCredits({ files, csv: realCsv, licenses }).failures).toEqual([]);
  });

  it("parseCsv respeita aspas, vírgula e aspas escapadas dentro do campo", () => {
    const { rows } = parseCsv(`${HEADER}\r\na.mp3,"x, ""y""",u,MIT,v,2026-11-09,"linha\ncom quebra"\n`);
    expect(rows).toHaveLength(1);
    expect(rows[0].autor).toBe('x, "y"');
    expect(rows[0].alteracoes).toBe("linha\ncom quebra");
  });

  it("arquivo sem crédito reprova", () => {
    const csv = [HEADER, line("audio/music/a.mp3")].join("\n");
    const r = checkCredits({ files: ["audio/music/a.mp3", "audio/sfx/b.ogg"], csv, licenses });
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toMatch(/^audio\/sfx\/b\.ogg: sem crédito/);
  });

  it("crédito órfão (linha audio/ sem arquivo) reprova; linha de models/ é ignorada", () => {
    const csv = [HEADER, line("audio/music/a.mp3"), line("audio/music/sumiu.mp3"), line("models/x.glb")].join("\n");
    const r = checkCredits({ files: ["audio/music/a.mp3"], csv, licenses });
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toMatch(/^audio\/music\/sumiu\.mp3: crédito órfão/);
  });

  it("licença fora da lista, coluna vazia e linha repetida reprovam", () => {
    const csv = [HEADER, line("audio/a.mp3", "Proprietária"), line("audio/b.mp3"), line("audio/b.mp3"),
      "audio/c.mp3,,https://x,CC0 1.0,https://y,2026-11-09,"].join("\n");
    const { failures } = checkCredits({ files: ["audio/a.mp3", "audio/b.mp3", "audio/c.mp3"], csv, licenses });
    expect(failures.some(f => /audio\/a\.mp3: licença "Proprietária"/.test(f))).toBe(true);
    expect(failures.some(f => /audio\/b\.mp3: 2 linhas/.test(f))).toBe(true);
    expect(failures.some(f => /audio\/c\.mp3: colunas vazias.*autor/.test(f))).toBe(true);
    expect(failures).toHaveLength(3);
  });

  it("cabeçalho sem as colunas obrigatórias reprova", () => {
    expect(checkCredits({ files: [], csv: "arquivo,autor\n", licenses }).failures[0]).toMatch(/sem as colunas/);
  });
});

describe("julgamento de loudness (A-7)", () => {
  const { loudness_lufs: L, loudness_tolerance: tol, true_peak_dbtp: tp } = cfg;
  const music = `${cfg.music_dir}/x.mp3`;
  it("música: na meta passa; fora de ± tolerância ou com pico real acima do teto reprova", () => {
    expect(judgeLoudness(music, { I: L, TP: tp }, cfg).ok).toBe(true);
    expect(judgeLoudness(music, { I: L + tol, TP: tp }, cfg).ok).toBe(true);
    expect(judgeLoudness(music, { I: L + tol + 0.1, TP: tp - 3 }, cfg).ok).toBe(false);
    expect(judgeLoudness(music, { I: L - tol - 0.1, TP: tp - 3 }, cfg).ok).toBe(false);
    expect(judgeLoudness(music, { I: L, TP: tp + 0.1 }, cfg).ok).toBe(false);
    expect(judgeLoudness(music, { I: -Infinity, TP: -Infinity }, cfg).ok).toBe(false);
  });
  it("efeito (fora de music_dir): só o pico real vale (LACUNA: sem meta de LUFS no GDD)", () => {
    const j = judgeLoudness("audio/sfx/x.ogg", { I: L + 10, TP: tp - 1 }, cfg);
    expect(j).toEqual({ kind: "efeito", ok: true, reasons: [] });
    expect(judgeLoudness("audio/sfx/x.ogg", { I: L, TP: tp + 0.5 }, cfg).ok).toBe(false);
  });
});

describe("loudness de MP3 sintéticos (A-7)", () => {
  it.runIf(!hasFfmpeg && inCI)("na CI o ffmpeg é obrigatório", () => {
    expect.fail("ffmpeg ausente no PATH com CI definido: os testes de loudness não podem ser pulados (instale com apt-get install ffmpeg)");
  });

  describe.skipIf(!hasFfmpeg)("com ffmpeg", () => {
    const tmp = mkdtempSync(join(tmpdir(), "thehell-a7-"));
    afterAll(() => rmSync(tmp, { recursive: true, force: true }));
    /**
     * MP3 estéreo de 5 s com senoide de 997 Hz e amplitude de pico `amp` (fração da escala cheia). Calibração medida com
     * ebur128 neste MP3 a 128 kbps: amp 0,16 ≈ −16,4 LUFS / −16,3 dBTP (na meta); amp 0,98 ≈ −0,6 LUFS / −0,6 dBTP (LUFS e pico real reprovam).
     */
    const tone = (rel: string, amp: number) => {
      const abs = join(tmp, rel);
      mkdirSync(join(abs, ".."), { recursive: true });
      const s = `${amp}*sin(2*PI*997*t)`;
      execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `aevalsrc=${s}|${s}:s=48000:d=5`, "-c:a", "libmp3lame", "-b:a", "128k", abs]);
    };

    it("MP3 alto demais reprova; um dentro da meta passa", () => {
      tone(`${cfg.music_dir}/alto.mp3`, 0.98);
      tone(`${cfg.music_dir}/certo.mp3`, 0.16);
      const rows = runLoudness({ publicDir: tmp, cfg });
      const by = Object.fromEntries(rows.map(r => [r.file.split("/").pop()!, r]));
      expect(rows).toHaveLength(2);
      expect(by["alto.mp3"].ok, JSON.stringify(by["alto.mp3"])).toBe(false);
      expect(by["alto.mp3"].reasons.some(x => x.startsWith("LUFS"))).toBe(true);
      expect(by["alto.mp3"].reasons.some(x => x.startsWith("pico real"))).toBe(true);
      expect(by["certo.mp3"].ok, JSON.stringify(by["certo.mp3"])).toBe(true);
      expect(by["certo.mp3"].kind).toBe("música");
    }, TIMEOUT);
  });
});

describe("arquivos de public/audio (A-7)", () => {
  it("extensão que não é de áudio reprova sem chamar o ffmpeg; arquivo oculto é ignorado", () => {
    const tmp = mkdtempSync(join(tmpdir(), "thehell-a7-ext-"));
    try {
      mkdirSync(join(tmp, "audio/sfx"), { recursive: true });
      writeFileSync(join(tmp, "audio/sfx/leia-me.txt"), "x");
      writeFileSync(join(tmp, "audio/.gitkeep"), "");
      const measure = () => { throw new Error("não deveria medir"); };
      const rows = runLoudness({ publicDir: tmp, cfg, measure });
      expect(rows.map(r => [r.file, r.kind, r.ok])).toEqual([["audio/sfx/leia-me.txt", "desconhecido", false]]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
