// Cliente THE HELL (fase 0): porte da tela do protótipo (prototype/the-hell.html) sobre a simulação de @thehell/sim.
// A lógica de jogo está toda em packages/sim; aqui ficam entrada, render, HUD, loja e áudio.
import * as THREE from "three";
import type { Balance, GameMap } from "@thehell/shared";
import { CLASSES, createGame, drainEvents, insideWall, makeConfig, step, STEP, type Arrow, type ClassName, type GameState, type PlayerInput } from "@thehell/sim";
import balanceJson from "@thehell/shared/generated/balance.json";
import mapsJson from "@thehell/shared/generated/maps.json";
import { CLASS_COLORS, HUNTER_COLORS, SKIN_COLORS, WORLD_COLORS } from "./look.ts";
import { classDescription, END_TEXT, goalText, messageText, SKIN_NAMES } from "./text.ts";

const balance = balanceJson as unknown as Balance;
const map = (mapsJson as unknown as Record<string, GameMap>).patio;
const cfg = makeConfig(balance, map);
const px = balance.prototype_extras;
const $ = (id: string) => document.getElementById(id)!;

// ---------- persistência local (moedas e skins, como no protótipo; servidor na fase 3) ----------
interface Save { co: number; own: string[]; eq: string }
let save: Save = { co: balance.economy.start_coins, own: ["std"], eq: "std" };
try { const j = JSON.parse(localStorage.getItem("thehell") || "null"); if (j) save = Object.assign(save, j); } catch { /* sem armazenamento */ }
const persist = () => { try { localStorage.setItem("thehell", JSON.stringify(save)); } catch { /* sem armazenamento */ } };
const hex = (n: number) => "#" + n.toString(16).padStart(6, "0");

// ---------- menu e loja ----------
let selected: ClassName = "Curandeiro";
function updateCoins() { $("co").textContent = String(save.co); }
function shop() {
  const s = $("shop");
  s.style.display = "flex";
  s.innerHTML = `<h1 style="font-size:30px">LOJA DE SKINS</h1><div>Moedas: <b>${save.co}</b> ⛁ · só cosméticos, sem vantagem no jogo</div><div id="sg"></div><button id="sx">Voltar</button>`;
  const grid = $("sg");
  for (const [id, price] of Object.entries(balance.skins)) {
    const k = SKIN_COLORS[id] ?? {}, own = save.own.includes(id), eq = save.eq === id;
    const d = document.createElement("div");
    d.className = "sk" + (eq ? " on" : "");
    const body = k.c == null ? "linear-gradient(90deg,#3fbf6a,#e0b030,#c83a3a)" : hex(k.c);
    d.innerHTML = `<div class="sw" style="background:${body}"><i style="background:${k.h ? hex(k.h) : "#d9b89a"}"></i>${k.t ? `<u style="background:${hex(k.t)}"></u>` : ""}</div><b>${SKIN_NAMES[id] ?? id}</b>`;
    const btn = document.createElement("button");
    btn.textContent = eq ? "Equipada" : own ? "Equipar" : `Comprar · ${price}`;
    btn.disabled = eq || (!own && save.co < price);
    btn.onclick = () => { if (!own) { save.co -= price; save.own.push(id); } save.eq = id; persist(); updateCoins(); shop(); };
    d.appendChild(btn);
    grid.appendChild(d);
  }
  $("sx").onclick = () => { s.style.display = "none"; };
}
const classBox = $("cls");
for (const cls of CLASSES) {
  const b = document.createElement("button");
  b.textContent = cls;
  b.onclick = () => { selected = cls; [...classBox.children].forEach(x => x.classList.toggle("on", x === b)); $("desc").textContent = classDescription(balance, cls); };
  classBox.appendChild(b);
}
(classBox.children[0] as HTMLButtonElement).click();
$("goal").textContent = goalText(balance, map.generators.length);
$("go").onclick = start;
$("sh").onclick = shop;
$("again").onclick = () => location.reload();
$("pzx").onmousedown = e => e.stopPropagation();
updateCoins();

// ---------- áudio (osciladores, como no protótipo) ----------
let audio: AudioContext | null = null;
function beep(f: number, d: number, v: number) {
  if (!audio) return;
  try {
    const o = audio.createOscillator(), gn = audio.createGain();
    o.frequency.value = f; gn.gain.setValueAtTime(v, audio.currentTime); gn.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + d);
    o.connect(gn); gn.connect(audio.destination); o.start(); o.stop(audio.currentTime + d);
  } catch { /* áudio indisponível */ }
}
const SOUNDS: Record<string, [number, number, number]> = { puzzle_ok: [660, 0.1, 0.2], puzzle_fail: [120, 0.25, 0.3], hit: [90, 0.2, 0.4], stun: [200, 0.15, 0.3], bolt: [300, 0.12, 0.3] };

// ---------- cena ----------
let G: GameState, R: THREE.WebGLRenderer, S: THREE.Scene, cam: THREE.PerspectiveCamera, PL: THREE.PointLight;
const meshes = new Map<string, THREE.Object3D>();
let yaw = 0, pitch = 0, thirdPerson = true, flash = 0, msgTime = 0, heartbeat = 0, acc = 0, last = 0, drag = false;
const keys: Record<string, boolean> = {};
const pending: Partial<PlayerInput> = {};

function tex(color: string, n: number, rx: number, rz: number) {
  const k = document.createElement("canvas"); k.width = k.height = 32;
  const x = k.getContext("2d")!;
  x.fillStyle = color; x.fillRect(0, 0, 32, 32);
  for (let i = 0; i < n; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * 0.4})`; x.fillRect((Math.random() * 32) | 0, (Math.random() * 32) | 0, 2, 2); }
  const t = new THREE.CanvasTexture(k);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, rz);
  return t;
}
const lambert = (o: THREE.MeshLambertMaterialParameters) => new THREE.MeshLambertMaterial({ flatShading: true, ...o });
const basic = (c: number, fog = false) => new THREE.MeshBasicMaterial({ color: c, fog });
function box(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); return b;
}
function figure(color: number, big: boolean, skin?: { c?: number | null; h?: number; t?: number }) {
  const g = new THREE.Group();
  g.add(box(big ? 1 : 0.6, big ? 2 : 1.1, big ? 0.8 : 0.4, lambert({ color: skin && skin.c != null ? skin.c : color }), 0, big ? 1.3 : 0.75, 0));
  g.add(box(0.4, 0.4, 0.4, lambert({ color: big ? HUNTER_COLORS.head : skin?.h ?? WORLD_COLORS.skinTone }), 0, big ? 2.5 : 1.55, 0));
  if (skin?.t) g.add(box(0.5, 0.2, 0.5, lambert({ color: skin.t }), 0, 1.85, 0));
  if (big) {
    g.add(box(0.1, 0.1, 0.05, basic(HUNTER_COLORS.eyes), -0.1, 2.55, -0.22), box(0.1, 0.1, 0.05, basic(HUNTER_COLORS.eyes), 0.1, 2.55, -0.22));
    g.add(box(0.2, 1.6, 0.2, lambert({ color: HUNTER_COLORS.arms }), -0.65, 1.3, 0), box(0.2, 1.6, 0.2, lambert({ color: HUNTER_COLORS.arms }), 0.65, 1.3, 0));
  }
  S.add(g);
  return g;
}

function init() {
  // three.js atual com a aparência da r128: sem gerenciamento de cor e luzes sem unidades físicas
  THREE.ColorManagement.enabled = false;
  R = new THREE.WebGLRenderer({ canvas: $("c") as HTMLCanvasElement, antialias: false });
  R.outputColorSpace = THREE.LinearSRGBColorSpace;
  R.setPixelRatio(1);
  R.setSize(384, 216, false);
  S = new THREE.Scene();
  S.background = new THREE.Color(WORLD_COLORS.background);
  S.fog = new THREE.Fog(WORLD_COLORS.background, 3, 30);
  cam = new THREE.PerspectiveCamera(px.camera.fov, 384 / 216, 0.1, 60);
  cam.rotation.order = "YXZ";
  S.add(new THREE.AmbientLight(WORLD_COLORS.ambient, 0.9 * Math.PI));
  PL = new THREE.PointLight(WORLD_COLORS.playerLight, 1.2 * Math.PI, 24, 1);
  S.add(PL);
  const [w, d] = map.size;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lambert({ map: tex(WORLD_COLORS.floor, 260, 18, 18) }));
  floor.rotation.x = -Math.PI / 2; S.add(floor);
  for (const [x, z, ww, wd] of map.walls) S.add(box(ww, map.wall_height, wd, lambert({ map: tex(WORLD_COLORS.wall, 200, Math.max(1, ww / 3), 1) }), x, map.wall_height / 2, z));
  S.add(box(2.6, 2.4, 2.6, new THREE.MeshBasicMaterial({ color: WORLD_COLORS.cage, wireframe: true }), map.cage[0], 1.2, map.cage[1]));
  G = createGame(cfg, selected, (Math.random() * 2 ** 31) | 0);
  G.gens.forEach((g, i) => {
    const gr = new THREE.Group();
    gr.add(box(1.5, 1, 1, lambert({ color: g.bonus ? WORLD_COLORS.bonusBody : WORLD_COLORS.genBody }), 0, 0.5, 0));
    const lamp = box(0.4, 0.3, 0.4, basic(0xff3333), 0, 1.2, 0); gr.add(lamp);
    gr.position.set(g.x, 0, g.z); S.add(gr);
    const beam = box(0.25, 14, 0.25, basic(0xff3333), g.x, 7, g.z); S.add(beam);
    meshes.set("lamp" + i, lamp); meshes.set("beam" + i, beam);
  });
  const gate = box(6, 3, 0.6, basic(WORLD_COLORS.gateClosed), map.gate[0], 1.5, map.gate[1] + 1); S.add(gate); meshes.set("gate", gate);
  G.survivors.forEach(s => meshes.set("s" + s.id, figure(CLASS_COLORS[s.cls], false, s.id === 0 ? SKIN_COLORS[save.eq] : undefined)));
  meshes.set("hunter", figure(HUNTER_COLORS.body, true));
  yaw = 0;
}

/** gancho somente-leitura para os testes ponta a ponta (tools/smoke.mjs) */
(window as unknown as { __thehell: () => GameState | undefined }).__thehell = () => G;

function start() {
  $("menu").style.display = "none";
  try { audio = new AudioContext(); } catch { audio = null; }
  try { const p = ($("c") as HTMLCanvasElement).requestPointerLock() as unknown as Promise<void> | undefined; p?.catch?.(() => {}); } catch { /* sem pointer lock */ }
  init();
  last = performance.now();
  requestAnimationFrame(loop);
}

// ---------- entrada ----------
const ARROW_KEYS: Record<string, Arrow> = { ArrowLeft: "left", ArrowUp: "up", ArrowRight: "right", ArrowDown: "down", KeyA: "left", KeyW: "up", KeyD: "right", KeyS: "down" };
const EXIT_KEYS = ["Escape", "Backspace", "KeyX", "KeyE", "ShiftLeft", "ShiftRight"]; // P-10: o Shift direito também sai
onkeydown = e => {
  if (!G) return;
  keys[e.code] = true;
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
  if (e.code === "KeyV") thirdPerson = !thirdPerson;
  if (e.code === "KeyQ" && !e.repeat) pending.ability = true;
  if (G.puzzle && EXIT_KEYS.includes(e.code)) { pending.puzzleExit = true; return; }
  if (e.code === "KeyE" && !e.repeat) pending.interact = true;
  if (G.puzzle) {
    if (G.puzzle.kind === "timing" && e.code === "Space") pending.puzzleSpace = true;
    else if (G.puzzle.kind === "sequence" && ARROW_KEYS[e.code] && !e.repeat) pending.puzzleArrow = ARROW_KEYS[e.code];
  }
};
onkeyup = e => { keys[e.code] = false; };
onmousemove = e => {
  if (!G || G.over) return;
  if (document.pointerLockElement || drag) { yaw -= e.movementX * 0.0025; pitch = Math.max(-1.2, Math.min(1.2, pitch - e.movementY * 0.0025)); }
};
onmousedown = () => { drag = true; if (G && !G.over) pending.attack = true; };
onmouseup = () => { drag = false; };
$("pzx").onclick = () => { pending.puzzleExit = true; };

function readInput(dt: number): PlayerInput {
  if (!G.puzzle) yaw += ((keys.ArrowLeft ? 1 : 0) - (keys.ArrowRight ? 1 : 0)) * 2 * dt;
  const input: PlayerInput = {
    forward: (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0), strafe: (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0),
    run: !!(keys.ShiftLeft || keys.ShiftRight), yaw, interact: !!pending.interact, interactHeld: !!keys.KeyE,
    ability: !!pending.ability, attack: !!pending.attack, puzzleSpace: pending.puzzleSpace, puzzleArrow: pending.puzzleArrow, puzzleExit: pending.puzzleExit,
  };
  for (const k of Object.keys(pending)) delete (pending as Record<string, unknown>)[k];
  return input;
}

// ---------- quadro ----------
function loop(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  acc += dt;
  while (acc >= STEP && !G.over) { step(cfg, G, readInput(STEP)); acc -= STEP; }
  for (const e of drainEvents(G)) {
    if (e.type === "msg") { msgTime = 3; $("msg").textContent = messageText(e); }
    else if (e.type === "sound") beep(...SOUNDS[e.name]);
    else if (e.type === "flash") flash = 0.5;
    else if (e.type === "end") {
      save.co += e.coins; persist();
      document.exitPointerLock?.();
      const [title, sub] = END_TEXT[e.outcome];
      $("et").textContent = title;
      $("es").textContent = `${sub} · Tempo: ${e.time} s · +${e.coins} moedas`;
      $("end").style.display = "flex";
    }
  }
  msgTime -= dt; flash -= dt;
  if (msgTime <= 0) $("msg").textContent = "";
  draw(dt);
  requestAnimationFrame(loop);
}

function draw(dt: number) {
  const P = G.survivors[0], H = G.hunter;
  for (const s of G.survivors) {
    const m = meshes.get("s" + s.id)!;
    m.position.set(s.x, 0, s.z); m.rotation.y = s.a; m.scale.y = s.st === "cage" ? 0.6 : 1;
    m.visible = (s.st === "ok" || s.st === "cage") && (s !== P || thirdPerson);
  }
  const hm = meshes.get("hunter")!; hm.position.set(H.x, 0, H.z); hm.rotation.y = H.a;
  G.gens.forEach((g, i) => {
    const c = g.bonus ? (g.done ? 0x555566 : 0x4da6ff) : g.done ? 0x33ff66 : g.n > 0 ? 0xffcc33 : 0xff3333;
    const lamp = meshes.get("lamp" + i) as THREE.Mesh, beam = meshes.get("beam" + i) as THREE.Mesh;
    (lamp.material as THREE.MeshBasicMaterial).color.set(c); (beam.material as THREE.MeshBasicMaterial).color.set(c);
    lamp.visible = Math.sin(G.t * 6) > -0.3;
  });
  if (G.gateOpen) ((meshes.get("gate") as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(WORLD_COLORS.gateOpen);
  const c = px.camera;
  if (thirdPerson) {
    let d = c.distance;
    const sx = Math.cos(yaw) * c.shoulder, sz = -Math.sin(yaw) * c.shoulder;
    while (d > 0.7 && insideWall(cfg, P.x + Math.sin(yaw) * d + sx, P.z + Math.cos(yaw) * d + sz)) d -= c.wall_step;
    cam.position.set(P.x + Math.sin(yaw) * d + sx, c.height, P.z + Math.cos(yaw) * d + sz);
  } else cam.position.set(P.x, 1.5, P.z);
  cam.rotation.set(pitch - (thirdPerson ? 0.2 : 0), yaw, 0);
  PL.position.set(P.x, 2.5, P.z);
  R.render(S, cam);
  hud(dt);
}

function hud(dt: number) {
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
  syncDynamic();
  const z = G.puzzle, panel = $("pz");
  if (!z) { panel.style.display = "none"; return; }
  panel.style.display = "block";
  const n = G.gens[z.gen].n + 1, total = b.generator.puzzles_per_generator;
  const AR: Record<Arrow, string> = { left: "←", up: "↑", right: "→", down: "↓" };
  $("pzc").innerHTML = z.kind === "timing"
    ? `<b>Gerador — quebra-cabeça ${n}/${total}</b><div class="bar"><i class="zn" style="left:${(z.zoneCenter - z.zoneWidth / 2) * 100}%;width:${z.zoneWidth * 100}%"></i><i class="cu" style="left:${z.t * 100}%"></i></div><small>ESPAÇO quando o marcador estiver na zona verde</small>`
    : `<b>Gerador — quebra-cabeça ${n}/${total}</b><div class="sq">${z.seq.map((a, i) => `<span class="${i < z.i ? "ok" : ""}">${AR[a]}</span>`).join("")}</div><small>repita a sequência com as setas ou WASD</small>`;
}

/** cria e remove malhas de projéteis e armadilhas conforme o estado */
function syncDynamic() {
  const alive = new Set<string>();
  for (const p of G.projectiles) {
    const key = "p" + p.id; alive.add(key);
    let m = meshes.get(key);
    if (!m) { m = new THREE.Mesh(new THREE.SphereGeometry(0.25, 6, 6), basic(HUNTER_COLORS.projectile, true)); S.add(m); meshes.set(key, m); }
    m.position.set(p.x, 1.2, p.z);
  }
  for (const t of G.traps) {
    const key = "t" + t.id; alive.add(key);
    if (!meshes.has(key)) { const m = box(0.9, 0.15, 0.9, basic(HUNTER_COLORS.trap, true), t.x, 0.08, t.z); S.add(m); meshes.set(key, m); }
  }
  for (const [key, m] of meshes) if ((key[0] === "p" || key[0] === "t") && !alive.has(key)) { S.remove(m); meshes.delete(key); }
}
