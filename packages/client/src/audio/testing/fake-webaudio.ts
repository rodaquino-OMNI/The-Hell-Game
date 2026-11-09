// Web Audio falso para testes em Node (A-5): o suficiente para engine.ts, spatial.ts e sfx.ts, com as validações
// da especificação que pegam receita errada (https://webaudio.github.io/web-audio-api/): tempo negativo ou não
// finito, rampa exponencial para valor ≤ 0, start duplo, stop antes de start, tipo de oscilador/filtro inválido,
// conexão com nó de outro contexto. Não é importado pelo jogo (só por packages/client/test e tools/audio).

export class FakeParam {
  value: number;
  calls: [string, number, number, number?][] = [];
  constructor(v = 0) { this.value = v; }
  private check(v: number, t: number) {
    if (!Number.isFinite(v)) throw new TypeError(`valor não finito: ${v}`);
    if (!Number.isFinite(t) || t < 0) throw new RangeError(`tempo inválido: ${t}`);
  }
  setValueAtTime(v: number, t: number) { this.check(v, t); this.calls.push(["set", v, t]); this.value = v; return this; }
  linearRampToValueAtTime(v: number, t: number) { this.check(v, t); this.calls.push(["lin", v, t]); this.value = v; return this; }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.check(v, t);
    if (v <= 0) throw new RangeError(`rampa exponencial para ${v}`);
    this.calls.push(["exp", v, t]); this.value = v; return this;
  }
  setTargetAtTime(v: number, t: number, tc: number) {
    this.check(v, t);
    if (!(tc > 0)) throw new RangeError(`constante de tempo ${tc}`);
    this.calls.push(["target", v, t, tc]); this.value = v; return this;
  }
  cancelScheduledValues(t: number) { this.check(0, t); this.calls.push(["cancel", 0, t]); return this; }
}

export class FakeNode extends EventTarget {
  out: unknown[] = [];
  constructor(readonly ctx: FakeContext) { super(); }
  connect<T>(n: T): T {
    const c = (n as { ctx?: FakeContext }).ctx;
    if (!(n instanceof FakeNode || n instanceof FakeParam) || (n instanceof FakeNode && c !== this.ctx)) {
      throw new Error("InvalidAccessError: destino de outro contexto");
    }
    this.out.push(n);
    return n;
  }
  disconnect() { this.out = []; }
}

export class FakeGain extends FakeNode { gain = new FakeParam(1); }

const FILTERS = ["lowpass", "highpass", "bandpass", "lowshelf", "highshelf", "peaking", "notch", "allpass"];
export class FakeFilter extends FakeNode {
  private _type = "lowpass";
  frequency = new FakeParam(350); Q = new FakeParam(1);
  get type() { return this._type; }
  set type(v: string) { if (!FILTERS.includes(v)) throw new TypeError(`filtro inválido: ${v}`); this._type = v; }
}

export class FakeScheduled extends FakeNode {
  startAt: number | null = null;
  stopAt: number | null = null;
  ended = false;
  start(t = 0) {
    if (this.startAt !== null) throw new Error("InvalidStateError: start duplo");
    if (!Number.isFinite(t) || t < 0) throw new RangeError(`start(${t})`);
    this.startAt = t;
    this.ctx.scheduled.push(this);
  }
  stop(t = 0) {
    if (this.startAt === null) throw new Error("InvalidStateError: stop antes de start");
    if (!Number.isFinite(t) || t < 0) throw new RangeError(`stop(${t})`);
    this.stopAt = t;
  }
}

const WAVES = ["sine", "square", "sawtooth", "triangle"];
export class FakeOsc extends FakeScheduled {
  private _type = "sine";
  frequency = new FakeParam(440); detune = new FakeParam(0);
  get type() { return this._type; }
  set type(v: string) { if (!WAVES.includes(v)) throw new TypeError(`onda inválida: ${v}`); this._type = v; }
}

export class FakeBuffer {
  private data: Float32Array;
  constructor(readonly numberOfChannels: number, readonly length: number, readonly sampleRate: number) {
    if (!(length > 0)) throw new Error("NotSupportedError: buffer vazio");
    this.data = new Float32Array(length);
  }
  get duration() { return this.length / this.sampleRate; }
  getChannelData(_c: number) { return this.data; }
}

export class FakeBufferSource extends FakeScheduled {
  buffer: FakeBuffer | null = null; loop = false; playbackRate = new FakeParam(1);
  override start(t = 0) {
    if (!this.buffer) throw new Error("fonte sem buffer");
    super.start(t);
  }
}

export class FakePanner extends FakeNode {
  panningModel = "equalpower"; distanceModel = "inverse"; refDistance = 1; maxDistance = 10000; rolloffFactor = 1;
  positionX = new FakeParam(); positionY = new FakeParam(); positionZ = new FakeParam();
}

export class FakeListener {
  positionX = new FakeParam(); positionY = new FakeParam(); positionZ = new FakeParam();
  forwardX = new FakeParam(); forwardY = new FakeParam(); forwardZ = new FakeParam();
  upX = new FakeParam(); upY = new FakeParam(); upZ = new FakeParam();
}

export class FakeContext extends EventTarget {
  state = "running";
  currentTime = 0;
  sampleRate = 48000;
  readonly destination: FakeNode = new FakeNode(this);
  listener = new FakeListener();
  /** fontes iniciadas (em ordem) */
  scheduled: FakeScheduled[] = [];
  created: FakeNode[] = [];
  private make<T extends FakeNode>(n: T): T { this.created.push(n); return n; }
  createGain() { return this.make(new FakeGain(this)); }
  createBiquadFilter() { return this.make(new FakeFilter(this)); }
  createOscillator() { return this.make(new FakeOsc(this)); }
  createBufferSource() { return this.make(new FakeBufferSource(this)); }
  createPanner() { return this.make(new FakePanner(this)); }
  createBuffer(ch: number, len: number, sr: number) { return new FakeBuffer(ch, len, sr); }
  resume = async () => {};
  close = async () => {};
  /** avança o relógio e dispara `ended` nas fontes cujo stop já passou */
  advance(t: number) {
    this.currentTime = t;
    const live: FakeScheduled[] = [];
    for (const s of this.scheduled) {
      if (!s.ended && s.stopAt !== null && s.stopAt <= t) { s.ended = true; s.dispatchEvent(new Event("ended")); }
      else if (!s.ended) live.push(s);
    }
    this.scheduled = live;
  }
}
