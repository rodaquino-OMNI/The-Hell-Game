// HUD: painéis do jogador, placar, equipe, dica de interação, mensagens, vinheta e batimento cardíaco.
import type { GameState } from "@thehell/sim";
import { beep } from "../audio/beeps.ts";
import { $, balance, px } from "../data.ts";

let flash = 0, msgTime = 0, heartbeat = 0;

export function showMessage(text: string) { msgTime = 3; $("msg").textContent = text; }
export function triggerFlash() { flash = 0.5; }

/** decai os temporizadores de mensagem e flash (uma vez por quadro, depois dos eventos) */
export function tickTimers(dt: number) {
  msgTime -= dt; flash -= dt;
  if (msgTime <= 0) $("msg").textContent = "";
}

export function hud(G: GameState, dt: number) {
  const P = G.survivors[0], H = G.hunter, dh = Math.hypot(P.x - H.x, P.z - H.z), b = balance;
  heartbeat -= dt;
  if (!G.over && heartbeat <= 0 && dh < px.heartbeat.radius) {
    beep(55, 0.12, 0.35); setTimeout(() => beep(48, 0.12, 0.25), 160);
    heartbeat = px.heartbeat.base_interval + (dh / px.heartbeat.radius) * px.heartbeat.range_interval;
  }
  $("vg").style.opacity = String(Math.min(1, Math.max(0, 1 - dh / px.vignette_radius) * 0.7 + Math.max(0, flash)));
  const secondary = P.cls === "Curandeiro" ? "" : `<br>${P.cls === "Mecânico" ? "Parafuso (clique): " : "Golpe: "}${P.atk > 0 ? Math.ceil(P.atk) + " s" : "PRONTO"}`;
  $("me").innerHTML = `<b>${P.cls}</b><div class="b"><i style="width:${Math.max(0, P.hp)}%;background:#c33"></i></div><div class="b"><i style="width:${P.stamina}%;background:var(--ye)"></i></div>Habilidade Q: ${P.cd > 0 ? Math.ceil(P.cd) + " s" : "PRONTA"}${secondary}${P.block > 0 ? "<br>BLOQUEIO ATIVO" : ""}${P.slow > 0 ? "<br>LENTO" : ""}`;
  const req = G.gens.filter(g => !g.bonus), bon = G.gens.filter(g => g.bonus);
  const done = req.filter(g => g.done).length, puzzles = req.reduce((a, g) => a + g.n, 0);
  const gateLine = G.gateStarted ? `<br><b style="color:#ff5a5a">${G.gateOpen ? "PORTÃO ABERTO — FUJA!" : `PORTÃO ABRE EM ${Math.ceil(G.gateTimer)} s`}</b>` : "";
  $("top").innerHTML = `Pontos ${G.points} · Bônus ${bon.filter(g => g.done).length}/${bon.length} · Geradores ${done}/${req.length} · Quebra-cabeças ${puzzles}/${req.length * b.generator.puzzles_per_generator}${gateLine}<div class="b" style="margin:4px auto"><i style="width:${Math.max(0, (H.hp / b.hunter.hp_base) * 100)}%;background:#a2a"></i></div>Caçador${H.stun > 0 ? " (ATORDOADO)" : ""}`;
  $("tm").innerHTML = G.survivors.map(s => `<div>${s.cls}${s.bot ? "" : " (você)"} — ${s.st === "ok" ? Math.max(0, Math.round(s.hp)) + " HP" : s.st === "cage" ? "PRESO " + Math.ceil(s.cage) + " s" : s.st === "out" ? "ESCAPOU" : "MORTO"}</div>`).join("");
  let hint = "&nbsp;";
  const near = (o: { x: number; z: number }, r: number) => Math.hypot(o.x - P.x, o.z - P.z) < r;
  const caged = G.survivors.find(a => a.st === "cage" && near(a, b.cage.rescue_range));
  const gen = G.gens.find(g => !g.done && near(g, px.interact_range.generator));
  if (P.rescue > 0) hint = `Resgatando… ${P.rescue.toFixed(1)}/${b.cage.rescue_time}`;
  else if (caged) hint = `[E] segure para resgatar ${caged.cls}`;
  else if (gen && !G.puzzle) hint = gen.bonus ? "[E] gerador bônus (só dá pontos)" : "[E] consertar gerador";
  else if (P.cls === "Mecânico" && G.traps.some(t => near(t, px.interact_range.trap))) hint = "[E] desativar armadilha";
  $("hint").innerHTML = hint;
}
