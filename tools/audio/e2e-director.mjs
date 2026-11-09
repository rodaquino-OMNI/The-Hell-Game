#!/usr/bin/env node
// e2e do diretor de áudio no laço real do jogo (ligação do V5: main.ts + hud.ts; docs/handoff/plano-audio-v5.md §5).
// Abre o jogo com ?debug=1 (D-33) e `audio.director_enabled: true` (D-32) e confere, pelo Chromium headless:
//  1. download inicial: antes do clique nenhuma request de MP3 (os stems carregam sob demanda depois do 1º gesto,
//     music.ts `createMusicDirector`); soma os bytes recebidos até o clique (GDD-v0.3 §10.6: ≤ 15 MB iniciais);
//  2. depois do clique, os 5 stems (`audio.music.stems`) chegam com HTTP 200 e Content-Type audio/mpeg e a música toca;
//  3. estado musical: ambient com o caçador no nascimento; o caçador é levado para perto do jogador (mutação de
//     window.__thehell(), só com ?debug=1) e o estado muda (tension ou chase, musicState.ts);
//  4. telegraph: com o jogador como único alvo (bots fora) e o caçador no alcance do golpe, de frente para ele, o 1º `telegraph_*` tocado pelo diretor (registro do gancho
//     window.__thehellAudioDirector) sai no MESMO quadro de render em que os olhos do caçador acendem
//     (window.__thehellRender.states().telegraph, render/sync.ts), comparando o relógio da partida dos dois;
//     mede a antecedência até o efeito em tempo de jogo, em tempo de áudio (descontando outputLatency/baseLatency,
//     quando o navegador expõe) e em tempo real (quadros de rAF);
//  5. legenda: com o telegraph tocado a ≤ audio.director.hunter_audible_radius (D-37, 30 m), getCaptions() tem a
//     legenda do telegraph (audio.captions.effects, A-6);
//  6. mudo: a tecla M zera o master (window.__thehellAudio) e mostra o aviso no HUD; M de novo restaura (D-41);
//  7. zero erros de console e pageerror.
// A página abre com `?ruleset=v1`: o telegraph (hunter.windup) só existe nas regras v1 (GDD-v0.2 §4.1).
// Opcional: `--record <arquivo.webm> [segundos]` grava a saída do master (MediaRecorder sobre um
// MediaStreamDestination ligado em paralelo ao AudioDestinationNode por um script de teste) durante uma partida curta
// com aproximação do caçador. Só ferramenta: o jogo não muda.
// Valores de data/balance.yaml (audio.*, hunter.*). Uso: node tools/audio/e2e-director.mjs [url] [--record f.webm [s]]
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(require("node:child_process").execSync("npm root -g").toString().trim() + "/playwright")); }
const { parse } = require("yaml");

const bal = parse(readFileSync(new URL("../../data/balance.yaml", import.meta.url), "utf8"));
const { audio, hunter } = bal;
const STEMS = audio.music.stems;
const AUDIBLE = audio.director.hunter_audible_radius;
const TELEGRAPH_CAPTION_KEYS = Object.entries(audio.captions.effects).filter(([n]) => n.startsWith("telegraph_")).map(([, e]) => e.key);
/** GDD-v0.3 §10.6: download inicial ≤ 15 MB (MB decimal) */
const INITIAL_MAX_BYTES = 15e6;

/** esperas máximas (ms; ferramenta, não jogo): folga para máquina carregada */
const SERVER_WAIT_MS = 5000, STEMS_WAIT_MS = 15000, STATE_WAIT_MS = 8000, TELEGRAPH_WAIT_MS = 10000, IDLE_MS = 1500, MODELS_WAIT_MS = 15000;
/** fração do alcance do golpe (hunter.melee.range) em que o caçador é posto ao lado do jogador */
const MELEE_FRACTION = 0.5;
/** fração do raio de tensão (audio.music.tension_radius) para a 1ª aproximação */
const TENSION_FRACTION = 0.6;

const args = process.argv.slice(2);
const ri = args.indexOf("--record");
const record = ri >= 0 ? { file: args[ri + 1], seconds: Number(args[ri + 2]) || 18 } : null;
if (ri >= 0) args.splice(ri, Number(args[ri + 2]) ? 3 : 2);
if (record && !record.file) { console.error("uso: --record <arquivo.webm> [segundos]"); process.exit(2); }

const freePort = () => new Promise((ok, ko) => { const s = createServer(); s.once("error", ko); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => ok(String(port))); }); });

let browser, server;
const fail = async (m) => { console.error("FALHA:", m); await browser?.close().catch(() => {}); server?.kill(); process.exit(1); };
let url = args[0];
if (!url) {
  const PORT = await freePort();
  url = "http://127.0.0.1:" + PORT;
  server = spawn(process.execPath, ["packages/server/dist/server.mjs"], { env: { ...process.env, PORT }, stdio: "inherit" });
  let up = false;
  for (const end = Date.now() + SERVER_WAIT_MS; Date.now() < end;) {
    if (server.exitCode !== null) await fail(`o servidor saiu com código ${server.exitCode}`);
    try { if ((await fetch(url + "/healthz")).ok) { up = true; break; } } catch { /* subindo */ }
    await sleep(100);
  }
  if (!up) await fail("o servidor não respondeu /healthz a tempo");
}

/** script de teste injetado antes da página: liga em paralelo ao destino de cada AudioContext um
 *  MediaStreamDestination e expõe a gravação em window.__e2eRec (só com --record) */
function recorderInit() {
  const orig = AudioNode.prototype.connect;
  const taps = new WeakMap();
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = orig.call(this, dest, ...rest);
    if (dest instanceof AudioDestinationNode) {
      const ctx = dest.context;
      let tap = taps.get(ctx);
      if (!tap) {
        tap = ctx.createMediaStreamDestination();
        taps.set(ctx, tap);
        window.__e2eRec = {
          start() {
            this.chunks = [];
            this.rec = new MediaRecorder(tap.stream, { mimeType: "audio/webm;codecs=opus" });
            this.rec.ondataavailable = e => { if (e.data.size) this.chunks.push(e.data); };
            this.rec.start(250);
          },
          stop() {
            return new Promise(ok => {
              this.rec.onstop = async () => {
                const b = new Blob(this.chunks, { type: "audio/webm" });
                const u8 = new Uint8Array(await b.arrayBuffer());
                let s = "";
                for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
                ok(btoa(s));
              };
              this.rec.stop();
            });
          },
        };
      }
      orig.call(this, tap);
    }
    return r;
  };
}

try {
  const health = await (await fetch(url + "/healthz")).json();
  if (!health.ok) await fail("/healthz sem ok");
  browser = await chromium.launch({ args: ["--autoplay-policy=user-gesture-required", "--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, locale: "pt-BR" });
  if (record) await page.addInitScript(recorderInit);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });

  // rede: todas as respostas, marcadas antes/depois do clique
  let clicked = false;
  const responses = [];
  page.on("requestfinished", async req => {
    const res = await req.response().catch(() => null);
    const sizes = await req.sizes().catch(() => null);
    responses.push({ url: req.url(), beforeClick: !clicked, status: res?.status() ?? 0, type: res?.headers()["content-type"] ?? "", bytes: sizes ? sizes.responseBodySize + sizes.responseHeadersSize : 0 });
  });
  page.on("requestfailed", req => responses.push({ url: req.url(), beforeClick: !clicked, status: 0, type: "", bytes: 0, failed: req.failure()?.errorText }));
  const isMp3 = u => /\.mp3(\?|$)/.test(u);

  // regras v1 (`?ruleset=v1`, packages/client/src/data.ts): só nelas o caçador tem preparo (hunter.windup, game.ts
  // `updateHunterV1`); no protótipo o golpe sai sem telegraph. É o ruleset da publicação (D-32)
  const debugUrl = new URL(url); debugUrl.searchParams.set("debug", "1"); debugUrl.searchParams.set("ruleset", "v1");
  await page.goto(debugUrl.href, { waitUntil: "networkidle" });
  await page.waitForTimeout(IDLE_MS);
  const hook = () => page.evaluate(() => (typeof window.__thehellAudioDirector === "function" ? window.__thehellAudioDirector() : null));
  const h0 = await hook();
  if (!h0) await fail("gancho window.__thehellAudioDirector ausente (audio.director_enabled false?)");
  if (!h0.enabled) await fail("diretor desligado: " + JSON.stringify(h0));
  const initial = responses.filter(r => r.beforeClick);
  const initialMp3 = initial.filter(r => isMp3(r.url));
  if (initialMp3.length) await fail("MP3 baixado antes do clique: " + initialMp3.map(r => r.url).join(", "));
  const initialBytes = initial.reduce((a, r) => a + r.bytes, 0);
  if (!(initialBytes <= INITIAL_MAX_BYTES)) await fail(`download inicial ${initialBytes} B > ${INITIAL_MAX_BYTES} B (GDD-v0.3 §10.6)`);

  clicked = true;
  await page.click("#go");

  // stems: 5 MP3 com 200 e audio/mpeg, e a música tocando
  let mp3 = [];
  for (const end = Date.now() + STEMS_WAIT_MS; Date.now() < end; await page.waitForTimeout(100)) {
    mp3 = responses.filter(r => isMp3(r.url));
    if (mp3.length >= STEMS.length && (await hook())?.music.playing) break;
  }
  for (const st of STEMS) {
    const r = mp3.find(x => x.url.endsWith(`/audio/music/${st}.mp3`));
    if (!r) await fail(`stem ${st}.mp3 não foi pedido depois do clique: ` + JSON.stringify(mp3));
    if (r.status !== 200) await fail(`stem ${st}.mp3 com HTTP ${r.status}`);
    if (!r.type.startsWith("audio/mpeg")) await fail(`stem ${st}.mp3 com Content-Type "${r.type}" (esperado audio/mpeg)`);
  }
  const h1 = await hook();
  if (!h1.music.playing) await fail("música não começou a tocar: " + JSON.stringify(h1.music));

  // os personagens entram na cena quando o .glb termina de carregar (render/characters/runtime.ts `createCharacter`,
  // pedido no clique); antes disso o caçador não tem modelo nem olhos e states().telegraph é false com windup
  // presente. Com rede lenta (espectro.glb, ~470 kB, junto com os stems) o .glb pode chegar depois do 1º preparo:
  // aí o JOGO toca o telegraph sem olhos na tela. Isso é um defeito real, não do teste. Ele foi reportado à sessão
  // Visual e decidido na D-45: start() espera charactersReady(), com teto e modelo de reserva, e a Visual tem um e2e
  // próprio com o .glb atrasado. Este teste mede o caso normal (caçador desenhável) e não cobre essa janela.
  // Mesmo gancho das capturas de arte (tools/visual/compare.mjs)
  const ready = await page.evaluate(ms => (typeof window.__thehellCharactersReady === "function"
    ? Promise.race([window.__thehellCharactersReady(), new Promise(ok => setTimeout(() => ok("timeout"), ms))])
    : "sem gancho"), MODELS_WAIT_MS);
  if (ready !== true) await fail("modelos dos personagens não carregaram: " + ready);

  // amostrador por quadro (rAF registrado depois do laço do jogo: roda depois do draw() do mesmo quadro)
  await page.evaluate(() => {
    const frames = (window.__e2eFrames = []);
    const tick = now => {
      const g = window.__thehell?.();
      if (g) {
        const w = g.hunter.windup;
        frames.push({ now, t: g.t, tele: window.__thehellRender.states().telegraph, windup: w ? { kind: w.kind, t: w.t } : null, atk: g.hunter.atk, dashing: g.hunter.dashing });
        if (frames.length > 4000) frames.shift();
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  if (record) await page.evaluate(() => window.__e2eRec.start());

  // estado musical: ambient com o caçador longe (nascimento) → perto
  const states = [];
  const noteState = async () => { const s = (await hook()).music.state; if (states[states.length - 1] !== s) states.push(s); return s; };
  for (const end = Date.now() + STATE_WAIT_MS; (await noteState()) !== "ambient" && Date.now() < end;) await page.waitForTimeout(100);
  if (states[states.length - 1] !== "ambient") await fail("estado musical inicial não é ambient: " + states.join(" → "));
  if (record) await page.waitForTimeout(Math.max(0, (record.seconds / 3) * 1000));
  const place = (k) => page.evaluate(k => { const g = window.__thehell(), p = g.survivors[0]; g.hunter.x = p.x + k; g.hunter.z = p.z; return Math.hypot(g.hunter.x - p.x, g.hunter.z - p.z); }, k);
  await place(audio.music.tension_radius * TENSION_FRACTION);
  for (const end = Date.now() + STATE_WAIT_MS; (await noteState()) === "ambient" && Date.now() < end;) await page.waitForTimeout(50);
  const near = states[states.length - 1];
  if (near !== "tension" && near !== "chase") await fail("estado musical não mudou com o caçador perto: " + states.join(" → "));
  if (record) await page.waitForTimeout(Math.max(0, (record.seconds / 3) * 1000));

  // telegraph: caçador no alcance do golpe, espera o 1º telegraph_* novo.
  // Com `ai.hunter_brain: utility` (IA do R3, packages/sim/src/ai/hunter.ts) o caçador percebe a 10 Hz num cone de
  // `hunter.vision_fov_deg` (ai/percept.ts), espera o tempo de reação da dificuldade e escolhe o alvo por utilidade
  // entre os sobreviventes livres: pode preferir um bot e sair andando. Para o teste medir o telegraph (e não a
  // escolha de alvo, que é da Frente R), o jogador fica como único alvo: os bots saem da partida (`st = "dead"`,
  // percept.ts e updateHunterAi só olham `st === "ok"`; o fim da partida v1 exige todos terminais, match.ts, e o
  // jogador segue "ok"). A memória da IA é limpa junto: com o alvo morto, think() não o vê mais, mas `ai.memory`
  // manteria a perseguição até a última posição dele (D-35, `chaseMemoryGoal`), longe do jogador. Com o cérebro
  // `basic` (sem `hunter.ai`) só os bots saem.
  const soloPlayer = () => page.evaluate(() => {
    const g = window.__thehell(), ai = g.hunter.ai;
    for (const s of g.survivors) if (s.bot) s.st = "dead";
    if (ai) { ai.target = -1; ai.score = 0; ai.memory = null; ai.loop = null; ai.intercept = null; }
    g.hunter.target = -1;
  });
  // põe o caçador a k m do jogador, de frente para ele (convenção de yaw da simulação: `a` olha para (−sen a, −cos a),
  // perception.ts `inCone`), e mantém o jogador revelado por `hunter.reveal.duration` (o efeito da revelação
  // periódica, game.ts `periodicReveal`; percept.ts entrega quem tem `revealed > 0` mesmo fora do cone). Sem isso, em
  // patrulha a IA anda ~3 m/s (`hunter.patrol_speed`) e gira para o próprio destino entre duas leituras do teste
  // (~100–150 ms reais no Chromium headless): sai do contato e do cone antes de vencer o tempo de reação, que exige o
  // jogador percebido de forma contínua (ai/hunter.ts `think`, `noticed`). Não mexe se já há preparo, para não
  // perturbar o quadro medido
  const aim = (k, reveal) => page.evaluate(([k, reveal]) => {
    const g = window.__thehell(), H = g.hunter, p = g.survivors[0];
    if (H.windup) return false;
    H.x = p.x + k; H.z = p.z; H.a = Math.atan2(-(p.x - H.x), -(p.z - H.z));
    p.revealed = reveal;
    return true;
  }, [k, reveal]);
  const playsBefore = (await hook()).plays.length;
  const frameBefore = (await hook()).frame;
  await soloPlayer();
  let tele = null, h2 = null;
  for (const end = Date.now() + TELEGRAPH_WAIT_MS; !tele && Date.now() < end;) {
    // a IA anda e gira entre as leituras: recoloca no alcance e de frente até surgir o preparo
    await aim(hunter.melee.range * MELEE_FRACTION, hunter.reveal.duration);
    await page.waitForTimeout(50);
    h2 = await hook();
    tele = h2.plays.find(p => p.frame > frameBefore && p.name.startsWith("telegraph_")) ?? null;
  }
  if (!tele) await fail("nenhum telegraph_* tocou com o caçador ao lado do jogador: " + JSON.stringify({ frame: h2?.frame, plays: h2?.plays.slice(playsBefore), state: await page.evaluate(() => { const g = window.__thehell(); return { t: g.t, over: g.over, H: { x: g.hunter.x, z: g.hunter.z, windup: g.hunter.windup, atk: g.hunter.atk, target: g.hunter.target, mode: g.hunter.ai?.mode ?? null }, P: g.survivors[0] }; }) }));
  if (!tele.windup) await fail("telegraph tocou sem windup no estado do quadro: " + JSON.stringify(tele));
  if (tele.name !== `telegraph_${tele.windup.kind}`) await fail("telegraph com kind errado: " + JSON.stringify(tele));
  // legenda do telegraph (A-6), lida logo depois
  const caption = h2.captions.find(c => TELEGRAPH_CAPTION_KEYS.includes(c.key)) ?? null;
  if (!(tele.hunterDist <= AUDIBLE)) await fail(`telegraph tocado a ${tele.hunterDist} m (> ${AUDIBLE} m, D-37)`);
  if (!caption) await fail("sem legenda de telegraph em getCaptions(): " + JSON.stringify(h2.captions));

  // espera, por estado, um quadro amostrado depois do som em que o preparo já acabou (efeito solto)
  const settled = await page.waitForFunction(t0 => window.__e2eFrames.some(f => f.t > t0 && !f.windup), tele.gameT, { timeout: TELEGRAPH_WAIT_MS, polling: 50 }).then(() => true, () => false);
  if (!settled) await fail("o preparo não terminou: " + JSON.stringify(await page.evaluate(() => window.__e2eFrames.slice(-5))));
  const frames = await page.evaluate(() => window.__e2eFrames.slice());
  // quadro do som = o quadro amostrado com o mesmo relógio da partida (o amostrador roda depois do draw do quadro)
  const seenIdx = frames.findIndex(f => Math.abs(f.t - tele.gameT) <= 1e-9);
  if (seenIdx < 0) await fail(`nenhum quadro amostrado com t=${tele.gameT} (quadro do som)`);
  const firstSeen = frames[seenIdx];
  if (!firstSeen.tele || !firstSeen.windup) await fail(`no quadro do som (t=${tele.gameT}) a render não mostrava o telegraph: ` + JSON.stringify(firstSeen));
  if (firstSeen.windup.kind !== tele.windup.kind) await fail("kind do visual ≠ kind do som: " + JSON.stringify({ firstSeen, tele }));
  // no quadro anterior não havia ESTE preparo: sem preparo, outro kind, ou um preparo mais velho (t restante menor)
  const prevFrame = frames[seenIdx - 1];
  if (prevFrame?.windup && prevFrame.windup.kind === firstSeen.windup.kind && prevFrame.windup.t >= firstSeen.windup.t) {
    await fail("o mesmo preparo já estava visível no quadro anterior ao som: " + JSON.stringify({ prevFrame, firstSeen }));
  }
  const endIdx = frames.findIndex((f, i) => i > seenIdx && !f.windup);
  const endFrame = frames[endIdx];
  const latency = tele.outputLatency && tele.outputLatency > 0 ? tele.outputLatency : (tele.baseLatency ?? 0);
  const leadGame = tele.windup.t; // s de jogo do quadro do som até o passo do efeito
  const measures = {
    version: health.version,
    inicial: { bytes: initialBytes, requests: initial.length, mp3AntesDoClique: initialMp3.length },
    mp3: STEMS.map(st => { const r = mp3.find(x => x.url.endsWith(`/${st}.mp3`)); return { stem: st, status: r.status, type: r.type, bytes: r.bytes }; }),
    musica: states,
    telegraph: {
      name: tele.name, quadro: tele.frame, gameT: tele.gameT, distancia_m: +tele.hunterDist.toFixed(2),
      mesmoQuadroQueOVisual: true,
      preparo_total_s: tele.windup.total,
      atraso_desde_inicio_do_preparo_s: +(tele.windup.total - tele.windup.t).toFixed(4),
      antecedencia_jogo_s: +leadGame.toFixed(4),
      outputLatency_s: tele.outputLatency, baseLatency_s: tele.baseLatency,
      antecedencia_ouvido_s: +(leadGame - latency).toFixed(4),
      antecedencia_tempo_real_s: +((endFrame.now - firstSeen.now) / 1000 - latency).toFixed(4),
      quadros_ate_o_efeito: endIdx - seenIdx,
    },
    legenda: { key: caption.key, dir: caption.dir, intensity: +caption.intensity.toFixed(3) },
  };

  if (record) {
    await page.waitForTimeout(Math.max(0, (record.seconds / 3) * 1000));
    const b64 = await page.evaluate(() => window.__e2eRec.stop());
    writeFileSync(record.file, Buffer.from(b64, "base64"));
    measures.gravacao = { arquivo: record.file, bytes: Buffer.byteLength(b64, "base64") };
  }

  // mudo do master na tecla M (D-41, audio/mute.ts): 0 e aviso no HUD; de novo M volta ao volume de antes
  const audioHook = () => page.evaluate(() => window.__thehellAudio());
  const before = (await audioHook()).buses.master;
  const msg = () => page.evaluate(() => document.getElementById("msg")?.textContent ?? "");
  const catalog = JSON.parse(readFileSync(new URL("../../packages/client/src/i18n/locales/pt-BR.json", import.meta.url), "utf8"));
  await page.keyboard.press("KeyM");
  const mutedVol = (await audioHook()).buses.master, mutedMsg = await msg();
  if (mutedVol !== 0) await fail(`M não zerou o master: ${mutedVol}`);
  if (mutedMsg !== catalog["caption.sound_muted"]) await fail(`aviso do mudo ausente no HUD: "${mutedMsg}"`);
  await page.keyboard.press("KeyM");
  const back = (await audioHook()).buses.master, backMsg = await msg();
  if (back !== before) await fail(`M de novo não restaurou o master: ${back} ≠ ${before}`);
  if (backMsg !== catalog["caption.sound_unmuted"]) await fail(`aviso de som ligado ausente no HUD: "${backMsg}"`);
  measures.mudo = { antes: before, mudo: mutedVol, depois: back };

  await browser.close();
  browser = undefined;
  if (errors.length) await fail("erros no console: " + errors.join(" | "));
  console.log("audio director e2e ok", JSON.stringify(measures));
} catch (e) {
  await fail(e?.stack ?? String(e));
} finally { server?.kill(); }
