// Cena e relógio comuns dos scripts que abrem o jogo para capturar ou medir (tools/visual/compare.mjs,
// tools/perf/budget.mjs, tools/art/a2-capturas.mjs, a2b-capturas.mjs, a3-capturas.mjs): semente, regras, cena de prova
// de legibilidade e a abertura com o relógio do Playwright parado, numa ordem única.
// Ordem: install → pauseAt → goto. O relógio é instalado e pausado ANTES de navegar: o Playwright reaplica o relógio a
// cada documento novo, e o boot do cliente não arma timer antes do #go (packages/client/src/main.ts: frames.start só
// em start()). Pausar depois do goto corria contra o relógio, que já anda em tempo real: com o carregamento lento,
// "clock.pauseAt: Cannot fast-forward to the past" (commit 56b3174, D-44).
// Fase do relógio: no documento novo o Playwright refaz o log (install, pauseAt) e performance.now() fica no atraso
// REAL entre as duas chamadas (alguns ms, varia de run para run), não em CLOCK.pausedAt como na ordem antiga (pauseAt
// depois do goto adiantava o relógio até lá). O requestAnimationFrame do relógio falso dispara nos múltiplos de 16 ms
// de performance.now() (playwright-core, injected/src/clock.ts: 16 - ticks % 16); quem anda o relógio com
// clock.runFor (a2b-capturas.mjs) ganharia um quadro a mais ou a menos conforme esse atraso. Por isso, depois do goto,
// o relógio anda até performance.now() = CLOCK.pausedAt e Date.now() volta a CLOCK.pausedAt: o mesmo estado da ordem
// antiga, sem depender do atraso real.

/** semente fixa das capturas e das medidas (partida e texturas procedurais) */
export const SEED = 1234;
// As referências (tools/visual/ref) e os marcos de arte A2, A2b e A3 (docs/art/marcos) foram capturados no layout 0
// com `ruleset: prototype` (padrão dos dados até o marco MJ-B). Desde o MJ-B o padrão é v1 (layout pela semente, IA do
// caçador): a captura fixa o protótipo pela via que o cliente já oferece (`?ruleset=`, só com `?debug=1`,
// packages/client/src/data.ts), para a comparação continuar medindo só o visual e os marcos continuarem reproduzíveis.
export const RULES = "ruleset=prototype";
/**
 * cena de prova de legibilidade (V4; tools/visual/compare.mjs e tools/art/a3-capturas.mjs): vista para o noroeste a
 * partir do spawn, com o caçador a `distance` m e `angle`° à esquerda da vista (fora do cone da lanterna), contra o
 * muro; `diff` = soma das diferenças RGB que marca um pixel do objeto
 */
export const LEG = { view: { yaw: 0.52, pitch: -0.1, thirdPerson: true }, distance: 8, angle: 40, diff: 12 };
/** a mesma cena com o caçador dentro do cone da lanterna (D-18): `angle`° à esquerda da vista */
export const LEG_IN = { ...LEG, angle: 8 };

/** instante inicial do relógio instalado e instante em que ele fica parado (ms; ferramenta, não regra de jogo) */
export const CLOCK = { installAt: 0, pausedAt: 1000 };

/** instala e pausa o relógio de `page`, navega para `url` (espera o evento load) e fixa a fase do relógio */
export async function gotoPaused(page, url) {
  await page.clock.install({ time: CLOCK.installAt });
  await page.clock.pauseAt(CLOCK.pausedAt);
  await page.goto(url, { waitUntil: "load" });
  const ticks = await page.evaluate(() => performance.now());
  if (ticks < CLOCK.pausedAt) await page.clock.runFor(CLOCK.pausedAt - ticks);
  await page.clock.setSystemTime(CLOCK.pausedAt);
  const now = await page.evaluate(() => [performance.now(), Date.now()]);
  if (now[0] !== CLOCK.pausedAt || now[1] !== CLOCK.pausedAt) throw new Error(`relógio fora da fase: performance.now() ${now[0]}, Date.now() ${now[1]}, esperado ${CLOCK.pausedAt}`);
}
