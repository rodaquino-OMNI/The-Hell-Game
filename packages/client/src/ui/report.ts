// Relatório de playtest na tela de fim (R8, "relatório humano"; packages/sim/src/report.ts `matchReport`): botões
// "Copiar relatório" (área de transferência) e "Baixar .json" (Blob + link `download` temporário, sem rede). Só com
// `?debug=1`, o mesmo portão dos ganchos de depuração (D-33, debug-hooks.ts): sem o parâmetro a coleta não liga
// (`createGame` sem opções) e a tela de fim não ganha nada (o DOM fica como antes).
// Acessibilidade (WCAG 2.2 AA; GDD v0.3 §12.4): botões nativos depois de "Jogar de novo" (ordem natural do Tab e da
// navegação por gamepad, ui/padnav.ts), aviso em aria-live polite ("Relatório copiado" ou o erro). A ativação de um
// destes botões não pula a contagem do resumo nem aciona "Jogar de novo" (results.ts `installSkip` ignora `#rpt`).
import type { GameOptions } from "@thehell/sim";
import { urlDebug } from "../debug-hooks.ts";
import { t } from "../i18n/index.ts";

/** id do bloco dos botões (results.ts não trata cliques dentro dele como "pular contagem") */
export const REPORT_BOX = "rpt";

/** relatório ligado (coleta e botões): só com `?debug=1` */
export const reportEnabled = (debug: boolean = urlDebug): boolean => debug;

/** opções de `createGame`: `{ report: true }` com depuração; sem ela, nenhuma (a chamada fica como antes) */
export const reportOptions = (debug: boolean = urlDebug): GameOptions | undefined => (reportEnabled(debug) ? { report: true } : undefined);

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * nome do arquivo: `the-hell-<seed>-<difficulty>-<YYYYMMDD-HHMM>.json`, com a data e a hora locais do relógio do
 * navegador em `now` (interface, não simulação)
 */
export function reportFileName(seed: number, difficulty: string, now: Date): string {
  const date = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
  const time = `${pad2(now.getHours())}${pad2(now.getMinutes())}`;
  return `the-hell-${seed}-${difficulty}-${date}-${time}.json`;
}

/** escreve na área de transferência; falso sem a API (contexto não seguro) ou com a permissão negada */
export async function copyText(text: string, clip: Pick<Clipboard, "writeText"> | undefined = globalThis.navigator?.clipboard): Promise<boolean> {
  if (!clip?.writeText) return false;
  try { await clip.writeText(text); return true; } catch { return false; }
}

/** baixa `text` como `name` (Blob e link `download` temporário fora da tela de fim; nada vai para a rede) */
// a URL do Blob só é revogada no download seguinte: revogar logo após o clique pode cortar a leitura em Firefox/Safari
let lastUrl: string | null = null;
export function downloadText(text: string, name: string) {
  if (lastUrl) URL.revokeObjectURL(lastUrl);
  const url = (lastUrl = URL.createObjectURL(new Blob([text], { type: "application/json" })));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
}

export interface ReportData {
  /** JSON de `matchReport(g)` */
  json: string;
  seed: number;
  difficulty: string;
}

function button(id: string, text: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.id = id;
  b.textContent = text;
  return b;
}

/**
 * monta os botões do relatório depois de `after` (o "Jogar de novo"); com `data` null ou sem depuração não monta nada
 * (e remove os de uma tela anterior, se houver). `now` é injetável (testes)
 */
export function showReport(data: ReportData | null, after: Element, debug: boolean = urlDebug, now: () => Date = () => new Date()) {
  document.getElementById(REPORT_BOX)?.remove();
  if (!data || !reportEnabled(debug)) return;
  const box = document.createElement("div");
  box.id = REPORT_BOX;
  const copy = button("rptc", t("report.copy"));
  const save = button("rptd", t("report.download"));
  const status = document.createElement("p");
  status.id = "rpts";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  copy.onclick = async () => {
    status.textContent = "";
    status.textContent = (await copyText(data.json)) ? t("report.copied") : t("report.copy_failed");
  };
  save.onclick = () => downloadText(data.json, reportFileName(data.seed, data.difficulty, now()));
  box.append(copy, save, status);
  after.after(box);
}
