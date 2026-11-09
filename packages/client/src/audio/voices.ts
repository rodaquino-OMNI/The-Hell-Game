// Gerenciador de vozes (item A-4 do V5; GDD-v0.3 §11 "limite de 32 vozes por prioridade", GDD-v0.2 §11): no máximo
// `audio.max_voices` vozes ativas; prioridade por tipo em `audio.voice_priority`. Núcleo puro: não toca Web Audio,
// só conta vagas e escolhe quem sai (spatial.ts liga as vozes ao grafo).
//
// Regra de roubo (docs/handoff/plano-audio-v5.md §1, "a 33ª derruba a de menor prioridade e mais antiga"):
//   - com vaga livre, a voz entra;
//   - lotado, a vítima é a voz ativa de MENOR prioridade e, entre as empatadas nessa prioridade, a MAIS ANTIGA
//     (menor `startedAt`; empate de relógio desfeito pela ordem de chegada);
//   - a nova entra se a prioridade dela for MAIOR OU IGUAL à da vítima; se for menor que todas, é recusada (null).
// Empate (nova com a mesma prioridade da menor ativa): derruba a mais antiga. Motivo: um som recém-disparado do mesmo
// tipo (passo, gerador) carrega a informação mais atual do jogo, e o mais antigo já foi ouvido; recusar a nova faria
// uma rajada antiga de passos calar os passos novos do caçador, por exemplo.
import { balance } from "../data.ts";

export interface Voice {
  /** sequencial, único por gerenciador */
  readonly id: number;
  readonly kind: string;
  readonly priority: number;
  /** instante de entrada, no relógio `now` do gerenciador */
  readonly startedAt: number;
  /** ainda ocupa uma vaga (false depois de release ou roubo) */
  readonly active: boolean;
  /** devolve a vaga (fim natural, `onended`, ou parada pelo dono); idempotente; não chama `onSteal` */
  release(): void;
}

export interface AcquireOpts {
  /** chamado uma vez quando a voz é derrubada por outra de prioridade maior ou igual; o dono para o som aqui */
  onSteal?: (v: Voice) => void;
}

export interface VoiceManagerOpts {
  /** vagas (audio.max_voices) */
  max?: number;
  /** prioridade por tipo (audio.voice_priority) */
  priorities?: Readonly<Record<string, number>>;
  /** relógio (s ou ms, só a ordem importa); padrão performance.now/Date.now */
  now?: () => number;
}

export interface VoiceManager {
  readonly max: number;
  /** ocupa uma vaga para o tipo `kind`; null = recusada (lotado e toda ativa com prioridade maior que a nova).
   *  Tipo fora de `priorities` lança erro (tipo digitado errado não pode tocar calado nem roubar vaga). */
  acquire(kind: string, opts?: AcquireOpts): Voice | null;
  /** prioridade do tipo; lança erro para tipo desconhecido */
  priorityOf(kind: string): number;
  /** vozes ativas na ordem de entrada */
  active(): Voice[];
  readonly count: number;
  /** libera todas sem chamar `onSteal` */
  clear(): void;
}

const defaultNow = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());

export function createVoiceManager(opts: VoiceManagerOpts = {}): VoiceManager {
  const max = opts.max ?? balance.audio.max_voices;
  const priorities = opts.priorities ?? balance.audio.voice_priority;
  const now = opts.now ?? defaultNow;
  if (!Number.isInteger(max) || max <= 0) throw new Error(`max_voices inválido: ${max}`);

  interface Slot extends Voice { active: boolean; seq: number; onSteal?: (v: Voice) => void }
  /** ativas na ordem de entrada (seq crescente) */
  const live: Slot[] = [];
  let seq = 0;

  const priorityOf = (kind: string): number => {
    const p = Object.prototype.hasOwnProperty.call(priorities, kind) ? priorities[kind] : undefined;
    if (typeof p !== "number") throw new Error(`tipo de voz desconhecido: "${kind}" (audio.voice_priority)`);
    return p;
  };

  const drop = (s: Slot) => {
    if (!s.active) return false;
    s.active = false;
    const i = live.indexOf(s);
    if (i >= 0) live.splice(i, 1);
    return true;
  };

  /** menor prioridade; empate: menor startedAt; empate: menor seq (entrou antes) */
  const victim = (): Slot | null => {
    let v: Slot | null = null;
    for (const s of live) {
      if (!v || s.priority < v.priority || (s.priority === v.priority && (s.startedAt < v.startedAt
        || (s.startedAt === v.startedAt && s.seq < v.seq)))) v = s;
    }
    return v;
  };

  return {
    max,
    priorityOf,
    acquire(kind, o = {}) {
      const priority = priorityOf(kind);
      if (live.length >= max) {
        const v = victim();
        if (!v || v.priority > priority) return null;
        drop(v);
        try { v.onSteal?.(v); } catch { /* dono com erro não impede a voz nova */ }
      }
      const id = ++seq;
      const s: Slot = {
        id, kind, priority, startedAt: now(), active: true, seq: id, onSteal: o.onSteal,
        release() { drop(s); },
      };
      live.push(s);
      return s;
    },
    active() { return live.slice(); },
    get count() { return live.length; },
    clear() { for (const s of live.slice()) drop(s); },
  };
}
