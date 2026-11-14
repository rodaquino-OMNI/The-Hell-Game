// HUD (GDD v0.3 §12.1): painel do jogador, objetivos e vida do caçador, retratos da equipe, dica de interação,
// mensagens, seta de ameaça em 8 setores, pings, modo espectador, vinheta e batimento cardíaco.
// Textos só por chave de tradução (i18n/); cores só por token da paleta (palette.ts); números de data/balance.yaml.
import type { GameState, Survivor, Vec } from "@thehell/sim";
import { beep } from "../audio/beeps.ts";
import { directorEnabled } from "../audio/director.ts";
import { $, balance, px } from "../data.ts";
import { num, t, type Key } from "../i18n/index.ts";
import { className, directionText, pingName } from "../text.ts";
import { isTutorialSkipKey, pingIndexOf } from "../input.ts";
import { requestTutorialSkip } from "./tutorial.ts";
import { THREAT_ARROW } from "./icons.ts";
import { newPingState, pingRemaining, prunePings, tryPing, type PingState } from "./ping.ts";
import { isSpectating, nextSpectatorTarget, resetSpectator, spectatorTarget } from "./spectator.ts";
import { portraitsHtml } from "./team.ts";
import { relativeSector, sectorDegrees, sectorDirection, threatSector } from "./threat.ts";

const ui = balance.ui;
/** troca o HTML só quando muda (o HUD é refeito a cada quadro) */
const lastHtml = new Map<string, string>();
const setHtml = (id: string, html: string) => { if (lastHtml.get(id) !== html) { lastHtml.set(id, html); $(id).innerHTML = html; } };
let flash = 0, msgTime = 0, heartbeat = 0;
let pings: PingState = newPingState();

export function showMessage(text: string) { msgTime = 3; $("msg").textContent = text; }
export function triggerFlash() { flash = 0.5; }

/** decai os temporizadores de mensagem e flash (uma vez por quadro, depois dos eventos) */
export function tickTimers(dt: number) {
  msgTime -= dt; flash -= dt;
  if (msgTime <= 0) $("msg").textContent = "";
}

/** nova partida: limpa pings e o aliado seguido pelo espectador */
export function resetHud() {
  pings = newPingState();
  resetSpectator();
  $("hud").hidden = false;
}

/** aliado seguido pela câmera no modo espectador (null fora do modo) */
export function cameraTarget(G: GameState): Survivor | null {
  return isSpectating(G) ? spectatorTarget(G) : null;
}

/** liga as teclas do HUD: 1–4 pings (`ui.ping_types`), Espaço troca o aliado no modo espectador, P pula etapa no Treino */
export function setupHud(game: () => GameState | undefined) {
  addEventListener("keydown", e => {
    const G = game();
    if (!G || G.over || e.repeat) return;
    // teclas dos pings remapeáveis (V8, `ui.controls.keyboard.ping_1..4`; padrão 1–4)
    if (pingByIndex(G, pingIndexOf(e.code))) return;
    // Treino (V6): "pular etapa" na tecla da ação `tutorial_skip`; um pedido por aperto (sem repetição da tecla)
    if (G.tutorial && isTutorialSkipKey(e.code)) { requestTutorialSkip(e.timeStamp); return; }
    if (e.code === "Space" && isSpectating(G)) { e.preventDefault(); nextSpectatorTarget(G); }
  });
  $("spn").onclick = () => { const G = game(); if (G) nextSpectatorTarget(G); };
}

/** ping `i` (0 a ui.ping_types − 1) do teclado ou do gamepad; false se o índice não é de ping */
export function pingByIndex(G: GameState, i: number): boolean {
  if (i < 0 || i >= ui.ping_types.length) return false;
  ping(G, ui.ping_types[i]);
  return true;
}

/** ping do jogador local na posição de quem ele controla ou assiste (a mira por raio fica para a fase 3) */
function ping(G: GameState, type: string) {
  const at: Vec = cameraTarget(G) ?? G.survivors[0];
  tryPing(pings, G.t, ui, { type, from: G.survivors[0].id, x: at.x, z: at.z });
}

const bar = (label: string, value: number, max: number, color: string) =>
  `<div class="b" role="meter" aria-label="${label}" aria-valuemin="0" aria-valuemax="${Math.round(max)}" aria-valuenow="${Math.max(0, Math.round(value))}"><i style="width:${Math.max(0, Math.min(100, (value / max) * 100))}%;background:var(${color})"></i></div>`;

const cd = (left: number, ready: Key, wait: Key) => (left > 0 ? t(wait, { n: Math.ceil(left) }) : t(ready));

export function hud(G: GameState, dt: number, yaw: number) {
  const P = G.survivors[0], H = G.hunter, b = balance;
  const spec = isSpectating(G), viewer: Vec = (spec ? spectatorTarget(G) : null) ?? P;
  const dh = Math.hypot(viewer.x - H.x, viewer.z - H.z);
  heartbeat -= dt;
  // com o diretor de áudio ligado o batimento sai de audio/director.ts (mesma fórmula); aqui tocaria em dobro
  if (!directorEnabled() && !G.over && !spec && heartbeat <= 0 && dh < px.heartbeat.radius) {
    beep(55, 0.12, 0.35); setTimeout(() => beep(48, 0.12, 0.25), 160);
    heartbeat = px.heartbeat.base_interval + (dh / px.heartbeat.radius) * px.heartbeat.range_interval;
  }
  $("vg").style.opacity = String(spec ? 0 : Math.min(1, Math.max(0, 1 - dh / px.vignette_radius) * 0.7 + Math.max(0, flash)));

  // painel do jogador (oculto no modo espectador)
  $("me").hidden = spec;
  if (!spec) {
    const secondary = P.cls === "Curandeiro" ? "" : `<br>${P.cls === "Mecânico" ? cd(P.atk, "hud.bolt_ready", "hud.bolt_cd") : cd(P.atk, "hud.strike_ready", "hud.strike_cd")}`;
    setHtml("me", `<b>${className(P.cls)}</b>${bar(t("hud.health"), P.hp, b.survivor.hp, "--ui-danger")}${bar(t("hud.stamina"), P.stamina, b.survivor.stamina.max, "--ui-text-dim")}` +
      `${cd(P.cd, "hud.ability_ready", "hud.ability_cd")}${secondary}${P.block > 0 ? `<br>${t("hud.block_active")}` : ""}${P.slow > 0 ? `<br>${t("hud.slow")}` : ""}`);
  }

  // objetivos e vida do caçador (H.maxHp: no v1 escala com dificuldade e time; no protótipo = hunter.hp_base)
  const req = G.gens.filter(g => !g.bonus), bon = G.gens.filter(g => g.bonus);
  const done = req.filter(g => g.done).length, puzzles = req.reduce((a, g) => a + g.n, 0);
  const gateLine = G.gateStarted ? `<br><b class="danger">${G.gateOpen ? t("hud.gate_open") : t("hud.gate_countdown", { n: Math.ceil(G.gateTimer) })}</b>` : "";
  const hunterLabel = H.stun > 0 ? t("hud.hunter_stunned") : t("hud.hunter");
  setHtml("top", t("hud.objectives", {
    points: G.points, bonusDone: bon.filter(g => g.done).length, bonusTotal: bon.length, done, total: req.length,
    puzzles, puzzlesTotal: req.length * b.generator.puzzles_per_generator,
  }) + gateLine + `<div class="hb">${bar(t("hud.hunter"), H.hp, H.maxHp, "--hunter-espectro")}</div>${hunterLabel}`);

  setHtml("tm", portraitsHtml(G.survivors, balance.survivor.wounded_hp));

  // dica de interação
  let hint = "";
  if (!spec) {
    const near = (o: Vec, r: number) => Math.hypot(o.x - P.x, o.z - P.z) < r;
    const caged = G.survivors.find(a => a.st === "cage" && near(a, b.cage.rescue_range));
    const gen = G.gens.find(g => !g.done && near(g, px.interact_range.generator));
    if (P.rescue > 0) hint = t("hud.hint.rescuing", { done: num(P.rescue, 1), total: b.cage.rescue_time });
    else if (caged) hint = t("hud.hint.rescue", { cls: className(caged.cls) });
    else if (gen && !G.puzzle) hint = gen.bonus ? t("hud.hint.bonus_generator") : t("hud.hint.generator");
    else if (P.cls === "Mecânico" && G.traps.some(tr => near(tr, px.interact_range.trap))) hint = t("hud.hint.trap");
  }
  const hintEl = $("hint");
  hintEl.textContent = hint;
  hintEl.hidden = !hint;

  threat(G, P, yaw, spec);
  pingPanel(G, viewer, yaw);
  spectator(G, spec);
}

/** seta de ameaça: só o setor (a distância e a posição exata não chegam ao DOM) */
function threat(G: GameState, P: Survivor, yaw: number, spec: boolean) {
  const el = $("threat");
  // "ou revelado" (GDD v0.3 §12.1): o sim ainda não tem revelação do caçador aos sobreviventes (ping do Batedor,
  // GDD-v0.2 §5.2, pós-MVP); quando tiver, o estado entra no último argumento.
  const s = G.over || spec || P.st !== "ok" ? null : threatSector(P, yaw, G.hunter, ui, false);
  if (s === null) { el.hidden = true; return; }
  const deg = sectorDegrees(s, ui.threat_sectors), rad = (deg * Math.PI) / 180;
  el.hidden = false;
  el.dataset.sector = String(s);
  el.style.left = `${50 + 44 * Math.sin(rad)}%`;
  el.style.top = `${50 - 40 * Math.cos(rad)}%`;
  el.style.transform = `translate(-50%,-50%) rotate(${deg}deg)`;
  if (!el.firstChild) el.innerHTML = THREAT_ARROW;
  el.setAttribute("aria-label", t("threat.label", { dir: directionText(sectorDirection(s, ui.threat_sectors)) }));
}

function pingPanel(G: GameState, viewer: Vec, yaw: number) {
  prunePings(pings, G.t, ui);
  const left = pingRemaining(pings, G.survivors[0].id, G.t, ui);
  $("pcd").textContent = left > 0 ? t("ping.cooldown", { n: num(left, 1) }) : t("ping.ready");
  setHtml("pf", pings.active.map(p => {
    const from = G.survivors.find(s => s.id === p.from);
    const who = !from || !from.bot ? t("ping.you") : className(from.cls);
    const inside = Math.hypot(p.x - viewer.x, p.z - viewer.z) < balance.survivor.radius;
    const s = inside ? null : relativeSector(viewer, yaw, p, ui.threat_sectors);
    const dir = directionText(s === null ? null : sectorDirection(s, ui.threat_sectors));
    return `<li class="pg">${t("ping.feed", { who, label: pingName(p.type), dir })}</li>`;
  }).join(""));
}

function spectator(G: GameState, spec: boolean) {
  const el = $("spec");
  el.hidden = !spec;
  if (!spec) return;
  const target = spectatorTarget(G);
  $("spt").textContent = G.survivors[0].st === "out" ? t("spec.escaped") : t("spec.dead");
  $("spw").textContent = target ? t("spec.watching", { cls: className(target.cls) }) : "";
}
