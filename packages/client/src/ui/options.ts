// Menu de opções (V8, F2-08; checklist do GDD-v0.3 §12.4): intensidades PS1 (§10.1), camada A (§10.2), reduzir
// flicker e balanço de câmera, fov (§12.2), volume por barramento (§11, audio/engine.ts), idioma (§12.5), tamanho da
// fonte, modo daltônico, controles (sensibilidade, inverter Y, alternar em vez de segurar, quebra-cabeça acessível) e
// remapeamento de teclas. Diálogo modal como a loja: só controles nativos (teclado e leitor de tela), foco no título
// ao abrir, Esc ou "Voltar" fecham e o foco volta ao botão "Opções". Cada mudança vale na hora e é gravada.
// Faixas e passos em data/balance.yaml (`ui.options`, `ui.controls`, `ui.fov`); textos só por chave (i18n/).
import { $, balance, px } from "../data.ts";
import { BUSES, getBusVolume, setBusVolume, type VolumeName } from "../audio/engine.ts";
import { CONTROL_ACTIONS, rebind, bindable, type ControlAction } from "../bindings.ts";
import { locale, t, type Key } from "../i18n/index.ts";
import { COLOR_MODE_OPTIONS, type ColorModeOption } from "../look.ts";
import { pingName } from "../text.ts";
import { applyOptions } from "./apply.ts";
import { setupLanguagePicker } from "./locale.ts";
import { defaultOptions, FONT_SIZES, LAYER_A_OPTIONS, PS1_OPTIONS, saveOptions, type FontSize, type Options } from "./settings.ts";

const PS1_LABEL: Record<(typeof PS1_OPTIONS)[number], Key> = { snap: "opt.ps1.snap", affine: "opt.ps1.affine", gouraud: "opt.ps1.gouraud", dither: "opt.ps1.dither" };
const LAYER_LABEL: Record<(typeof LAYER_A_OPTIONS)[number], Key> = {
  grain: "opt.layer.grain", vignette: "opt.layer.vignette", scanlines: "opt.layer.scanlines", aberration: "opt.layer.aberration", bloom: "opt.layer.bloom",
};
const VOLUME_LABEL: Record<VolumeName, Key> = { master: "opt.vol.master", music: "opt.vol.music", sfx: "opt.vol.sfx", voice: "opt.vol.voice", ui: "opt.vol.ui" };
const FONT_LABEL: Record<FontSize, Key> = { normal: "opt.font.normal", large: "opt.font.large", xlarge: "opt.font.xlarge" };
const COLOR_LABEL: Record<ColorModeOption, Key> = { normal: "opt.color.normal", protanopia: "opt.color.protanopia", deuteranopia: "opt.color.deuteranopia", tritanopia: "opt.color.tritanopia" };
const ACTION_LABEL: Record<Exclude<ControlAction, "ping_1" | "ping_2" | "ping_3" | "ping_4">, Key> = {
  forward: "act.forward", back: "act.back", left: "act.left", right: "act.right", run: "act.run", interact: "act.interact",
  ability: "act.ability", attack: "act.attack", camera: "act.camera", look_left: "act.look_left", look_right: "act.look_right",
  puzzle_confirm: "act.puzzle_confirm",
};
const PING_ACTIONS = ["ping_1", "ping_2", "ping_3", "ping_4"] as const;
/** nomes dos botões no layout "standard" da Gamepad API (https://w3c.github.io/gamepad/#remapping); símbolos, sem idioma */
const PAD_BUTTON = ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "Select", "Start", "L3", "R3", "↑", "↓", "←", "→", "Home"];
const ARROW_KEY: Record<string, string> = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" };
const NAMED_KEY: Record<string, Key> = { Space: "key.space", ShiftLeft: "key.shift_left", ShiftRight: "key.shift_right", ControlLeft: "key.ctrl_left", ControlRight: "key.ctrl_right", AltLeft: "key.alt_left", AltRight: "key.alt_right", Enter: "key.enter", Backspace: "key.backspace" };

/** nome da ação no idioma atual (pings: "Ping: <tipo>") */
export function actionName(a: ControlAction): string {
  const pi = (PING_ACTIONS as readonly string[]).indexOf(a);
  return pi >= 0 ? t("act.ping", { name: pingName(balance.ui.ping_types[pi]) }) : t(ACTION_LABEL[a as keyof typeof ACTION_LABEL]);
}

/** nome legível de uma tecla (KeyboardEvent.code) */
export function keyName(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return t("key.numpad", { n: code.slice(6) });
  if (ARROW_KEY[code]) return ARROW_KEY[code];
  if (NAMED_KEY[code]) return t(NAMED_KEY[code]);
  return code;
}
const keysText = (codes: readonly string[]) => (codes.length ? codes.map(keyName).join(" / ") : t("key.unbound"));

let opts: Options = defaultOptions();
let onLanguage: () => void = () => {};
/** ação esperando a nova tecla (captura do remapeamento) */
let capturing: ControlAction | null = null;

/** opções atuais (lidas por main.ts ao começar a partida e pelo gancho dos testes) */
export const currentOptions = () => opts;

/** opções carregadas no início; `languageChanged` refaz os textos do menu inicial */
export function setupOptions(initial: Options, languageChanged: () => void) {
  opts = initial;
  onLanguage = languageChanged;
  $("op").onclick = () => openOptions();
}

function commit(o: Options) {
  opts = o;
  saveOptions(opts);
  applyOptions(opts);
}

function announce(msg: string) { $("olive").textContent = msg; }

/** elemento com propriedades DOM (id, type, className…) e filhos */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e: HTMLElementTagNameMap[K] = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
}

const pct = (v: number) => new Intl.NumberFormat(locale(), { style: "percent", maximumFractionDigits: 0 }).format(v);

/** linha com rótulo, slider e valor; `onInput` recebe o número */
function slider(id: string, label: string, v: number, min: number, max: number, step: number, fmt: (v: number) => string, onInput: (v: number) => void) {
  const input = el("input", { type: "range", id, min: String(min), max: String(max), step: String(step), value: String(v) });
  const out = el("output", { id: id + "-v" }, fmt(v));
  out.htmlFor.add(id);
  input.setAttribute("aria-valuetext", fmt(v));
  input.oninput = () => {
    const n = Number(input.value);
    out.textContent = fmt(n);
    input.setAttribute("aria-valuetext", fmt(n));
    onInput(n);
  };
  return el("div", { className: "orow" }, el("label", { htmlFor: id }, label), input, out);
}

function checkbox(id: string, label: string, on: boolean, onChange: (v: boolean) => void, hint?: string) {
  const input = el("input", { type: "checkbox", id, checked: on });
  input.onchange = () => onChange(input.checked);
  const row = el("div", { className: "orow ock" }, input, el("label", { htmlFor: id }, label));
  if (hint) { input.setAttribute("aria-describedby", id + "-h"); row.append(el("small", { id: id + "-h", className: "ohint" }, hint)); }
  return row;
}

function radios<T extends string>(name: string, legend: string, values: readonly T[], label: (v: T) => string, cur: T, onChange: (v: T) => void, hint?: string) {
  const fs = el("fieldset", { className: "orad" }, el("legend", {}, legend));
  for (const v of values) {
    const id = `${name}-${v}`;
    const input = el("input", { type: "radio", name, id, value: v, checked: v === cur });
    input.onchange = () => { if (input.checked) onChange(v); };
    fs.append(el("span", {}, input, el("label", { htmlFor: id }, label(v))));
  }
  if (hint) fs.append(el("small", { className: "ohint" }, hint));
  return fs;
}

const section = (id: string, title: string, ...kids: Node[]) => el("fieldset", { className: "osec", id }, el("legend", {}, title), ...kids);

function keyRow(a: ControlAction) {
  const lid = "kl-" + a, bid = "kb-" + a;
  const b = el("button", { type: "button", id: bid }, capturing === a ? t("opt.key_wait") : keysText(opts.keys[a]));
  b.setAttribute("aria-labelledby", `${lid} ${bid}`);
  if (capturing === a) b.setAttribute("aria-pressed", "true");
  b.onclick = () => startCapture(a);
  return el("div", { className: "orow okey" }, el("span", { id: lid }, actionName(a)), b);
}

function startCapture(a: ControlAction) {
  capturing = a;
  rerenderKeys(a);
  announce(t("opt.key_prompt", { action: actionName(a) }));
}

function endCapture(focus: ControlAction) {
  capturing = null;
  rerenderKeys(focus);
}

/** tecla apertada durante a captura (fase de captura do window: nada mais recebe a tecla) */
function onCaptureKey(e: KeyboardEvent) {
  if (!capturing) return;
  const a = capturing;
  if (e.code === "Tab") { capturing = null; rerenderKeys(null); announce(t("opt.key_cancel")); return; } // Tab segue navegando (sem armadilha de teclado)
  e.preventDefault();
  e.stopPropagation();
  if (e.code === "Escape" || !bindable(e.code)) { endCapture(a); announce(t("opt.key_cancel")); return; }
  const r = rebind(opts.keys, a, e.code);
  commit({ ...opts, keys: r.bindings });
  endCapture(a);
  const moved = r.displaced.length ? " " + t("opt.key_moved", { key: keyName(e.code), actions: r.displaced.map(actionName).join(", ") }) : "";
  announce(t("opt.key_set", { action: actionName(a), key: keyName(e.code) }) + moved);
}

function rerenderKeys(focus: ControlAction | null) {
  const box = document.getElementById("okeys");
  if (!box) return;
  box.replaceChildren(...CONTROL_ACTIONS.map(keyRow));
  if (focus) $("kb-" + focus).focus();
}

function padList() {
  const b = balance.ui.controls.gamepad.buttons;
  const rows: [string, number][] = [
    [actionName("interact"), b.interact], [t("act.puzzle_exit"), b.puzzle_exit], [actionName("run"), b.run], [actionName("attack"), b.attack],
    [actionName("ability"), b.ability], [actionName("camera"), b.camera],
    ...PING_ACTIONS.map(p => [actionName(p), b[p]] as [string, number]),
  ];
  return el("ul", { className: "opad" }, ...rows.map(([n, i]) => el("li", {}, `${n}: ${PAD_BUTTON[i] ?? String(i)}`)));
}

function build(): HTMLElement[] {
  const o = opts, ob = balance.ui.options, step = ob.intensity_step, fr = balance.ui.fov, sens = balance.ui.controls.sensitivity;
  const video = section("os-video", t("opt.sec.video"),
    ...PS1_OPTIONS.map(e => slider("o-ps1-" + e, t(PS1_LABEL[e]), o.ps1[e], 0, 1, step, pct, v => commit({ ...opts, ps1: { ...opts.ps1, [e]: v } }))));
  const layer = section("os-layer", t("opt.sec.layer"),
    ...LAYER_A_OPTIONS.map(e => slider("o-la-" + e, t(LAYER_LABEL[e]), o.layerA[e], 0, 1, step, pct, v => commit({ ...opts, layerA: { ...opts.layerA, [e]: v } }))));
  const comfort = section("os-comfort", t("opt.sec.comfort"),
    checkbox("o-flicker", t("opt.reduce_flicker"), o.reduceFlicker, v => commit({ ...opts, reduceFlicker: v }), t("opt.reduce_flicker_hint")),
    checkbox("o-bob", t("opt.reduce_bob"), o.reduceCameraBob, v => commit({ ...opts, reduceCameraBob: v })),
    slider("o-outline", t("opt.hunter_outline"), o.hunterOutline, 0, 1, step, pct, v => commit({ ...opts, hunterOutline: v })),
    slider("o-fov", t("opt.fov"), o.fov ?? px.camera.fov, fr.min, fr.max, ob.fov_step, v => t("opt.value_deg", { v }), v => commit({ ...opts, fov: v })));
  const audio = section("os-audio", t("opt.sec.audio"),
    ...(["master", ...BUSES] as VolumeName[]).map(b => slider("o-vol-" + b, t(VOLUME_LABEL[b]), getBusVolume(b), 0, 1, step, pct, v => { setBusVolume(b, v); })));
  const langBox = el("div", { id: "olangs", className: "olangs" });
  langBox.setAttribute("role", "group");
  langBox.setAttribute("aria-labelledby", "olangl");
  const iface = section("os-ui", t("opt.sec.interface"),
    el("div", { className: "orow olrow" }, el("span", { id: "olangl" }, t("lang.label")), langBox),
    radios("o-font", t("opt.font"), FONT_SIZES, f => t(FONT_LABEL[f]), o.fontSize, v => commit({ ...opts, fontSize: v })),
    radios("o-color", t("opt.color"), COLOR_MODE_OPTIONS, m => t(COLOR_LABEL[m]), o.colorMode, v => commit({ ...opts, colorMode: v }), t("opt.color_note")));
  const controls = section("os-controls", t("opt.sec.controls"),
    slider("o-sens", t("opt.sensitivity"), o.sensitivity, sens.min, sens.max, sens.step, v => t("opt.value_times", { v }), v => commit({ ...opts, sensitivity: v })),
    checkbox("o-invy", t("opt.invert_y"), o.invertY, v => commit({ ...opts, invertY: v })),
    checkbox("o-trun", t("opt.toggle_run"), o.toggleRun, v => commit({ ...opts, toggleRun: v })),
    checkbox("o-tint", t("opt.toggle_interact"), o.toggleInteract, v => commit({ ...opts, toggleInteract: v })),
    checkbox("o-puz", t("opt.puzzle_accessible"), o.puzzleAccessible, v => commit({ ...opts, puzzleAccessible: v }), t("opt.puzzle_accessible_hint", { pct: Math.round(balance.puzzles.accessible.zone_mult * 100) })));
  const keys = section("os-keys", t("opt.sec.keys"), el("small", { className: "ohint", id: "okh" }, t("opt.keys_hint")), el("div", { id: "okeys" }, ...CONTROL_ACTIONS.map(keyRow)));
  const pad = section("os-pad", t("opt.sec.gamepad"), el("small", { className: "ohint" }, t("opt.pad_hint")), padList());
  const head = el("h1", { id: "optt", tabIndex: -1 }, t("opt.title"));
  const live = el("p", { id: "olive", className: "dim" });
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  const reset = el("button", { type: "button", id: "orst" }, t("opt.reset"));
  reset.onclick = () => {
    const d = defaultOptions();
    for (const b of ["master", ...BUSES] as VolumeName[]) setBusVolume(b, balance.audio.buses[b]);
    commit(d);
    render("orst");
    announce(t("opt.reset_done"));
  };
  const close = el("button", { type: "button", id: "ox" }, t("opt.back"));
  close.onclick = closeOptions;
  return [head, el("p", { className: "dim" }, t("opt.note")), el("div", { className: "ogrid" }, video, layer, comfort, audio, iface, controls, keys, pad), live, el("div", {}, reset, close)];
}

function render(focusId?: string) {
  const d = $("opts");
  d.replaceChildren(...build());
  setupLanguagePicker($("olangs"), () => {
    onLanguage();
    render();
    ($("olangs").querySelector("[aria-pressed=true]") as HTMLElement | null)?.focus();
  });
  $(focusId ?? "optt").focus();
}

export function openOptions(focusId?: string) {
  const d = $("opts");
  d.hidden = false;
  $("menu").inert = true;
  capturing = null;
  render(focusId);
  d.onkeydown = e => { if (e.key === "Escape" && !capturing) { e.stopPropagation(); closeOptions(); } };
  addEventListener("keydown", onCaptureKey, true);
}

export function closeOptions() {
  capturing = null;
  removeEventListener("keydown", onCaptureKey, true);
  $("opts").hidden = true;
  $("menu").inert = false;
  $("op").focus();
}
