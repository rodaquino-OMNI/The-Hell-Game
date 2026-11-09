// Portão do início da partida (D-45): a simulação só começa quando os personagens estão na cena (charactersReady),
// para o caçador nunca preparar golpe ou dash invisível (telegraph sem visual). Enquanto espera, o botão "Começar"
// mostra o estado de carregando (aria-busy, desativado sem perder o foco). Teto `ui.start_wait_s` (data/balance.yaml):
// passado o teto, ou se a espera falhar, a partida começa assim mesmo com o modelo de reserva
// (render/characters/runtime.ts) e o motivo vai para o console. Sem DOM aqui: a interface entra por `ui` (teste em
// packages/client/test/start-gate.test.ts).

/** como a espera terminou: personagens prontos, teto de tempo ou falha da promessa */
export type StartOutcome = "pronto" | "tempo" | "erro";

export interface StartGateOptions {
  /** resolve quando os personagens criados estão na cena */
  ready: () => Promise<unknown>;
  /** teto da espera em s (ui.start_wait_s) */
  timeoutS: number;
  /** liga e desliga o estado de carregando do botão */
  setBusy: (on: boolean) => void;
  /** aviso do teto ou da falha (padrão: console.warn) */
  log?: (msg: string) => void;
  setTimer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

export interface StartGate {
  /** espera em curso (um segundo clique em "Começar" não inicia outra partida) */
  busy(): boolean;
  /** espera os personagens (no máximo `timeoutS`) com o botão em carregando; devolve como terminou */
  wait(): Promise<StartOutcome>;
}

export function startGate(o: StartGateOptions): StartGate {
  const log = o.log ?? ((m: string) => console.warn(m));
  const setTimer = o.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer = o.clearTimer ?? (id => clearTimeout(id as ReturnType<typeof setTimeout>));
  let waiting = false;
  return {
    busy: () => waiting,
    async wait() {
      waiting = true;
      o.setBusy(true);
      let timer: unknown;
      const timeout = new Promise<StartOutcome>(resolve => { timer = setTimer(() => resolve("tempo"), o.timeoutS * 1000); });
      const ready = Promise.resolve().then(o.ready).then((): StartOutcome => "pronto", (e: unknown): StartOutcome => {
        log(`personagens: falha na espera (${e instanceof Error ? e.message : String(e)}); a partida começa com o modelo de reserva`);
        return "erro";
      });
      const outcome = await Promise.race([ready, timeout]);
      clearTimer(timer);
      if (outcome === "tempo") log(`personagens: não carregaram em ${o.timeoutS} s (ui.start_wait_s); a partida começa com o modelo de reserva`);
      o.setBusy(false);
      waiting = false;
      return outcome;
    },
  };
}

/**
 * roda `cb` com a página carregada e o navegador ocioso (D-45: pré-carga dos .glb com o menu aberto, fora do download
 * crítico do primeiro quadro). Sem requestIdleCallback (Safari), um setTimeout 0 depois do `load`
 */
export function afterLoadIdle(cb: () => void, w: Window = window) {
  const idle = () => { if (w.requestIdleCallback) w.requestIdleCallback(() => cb()); else w.setTimeout(cb, 0); };
  if (w.document.readyState === "complete") idle();
  else w.addEventListener("load", idle, { once: true });
}
