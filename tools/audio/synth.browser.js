// Síntese dos 5 stems de música (item A-3 do V5; GDD-v0.3 §11; docs/handoff/plano-audio-v5.md §2). Roda DENTRO do
// Chromium (injetado por tools/audio/compose.ts com page.addScriptTag) e renderiza com OfflineAudioContext.
// Síntese PS1 pura (decisão do Rodrigo, 09/11/2026): só osciladores, ruído, filtros, envelopes e reverb/eco; sem samples.
// Terror leve 12+: sem gritos nem sons de violência.
//
// Loop sem estalo, por construção:
// - toda fonte começa em t ≥ 0 e termina (com release) antes de L + T (L = loop, T = cauda); o grafo depois das
//   fontes é linear (filtros, ganhos, eco, convolução), então somar a cauda [L, L+T) no início [0, T) dá exatamente
//   a resposta em regime periódico (o que tocaria se o loop já estivesse rodando);
// - fontes contínuas (drones, vento, LFOs, glissando de Shepard) têm número inteiro de ciclos em L (freqLoop), então
//   a extensão periódica delas é contínua em valor e derivada.
// Determinismo: nenhuma fonte de aleatoriedade além do PRNG mulberry32 com a semente recebida (audio.compose.seed).
//
// Números musicais (notas, ganhos relativos, envelopes) são o conteúdo da composição, não números de jogo; o andamento,
// compasso, tom, duração do loop, cauda, semente e taxa vêm de data/balance.yaml (audio.music.*, audio.compose.*).
(() => {
  "use strict";

  /** mulberry32: PRNG de 32 bits com semente (mesma família do packages/sim/src/rng.ts) */
  const mulberry32 = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  const PITCH_CLASS = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };
  /** "D minor" → MIDI da tônica na oitava 2 (D2 = 38). Só modo menor: a composição é escrita em graus do menor. */
  const tonicMidi = (key) => {
    const m = /^([A-G](?:#|b)?)\s+minor$/.exec(key.trim());
    if (!m) throw new Error(`tom não suportado pela composição: "${key}" (esperado "<nota> minor")`);
    return 36 + PITCH_CLASS[m[1]];
  };
  const mtof = (midi) => 440 * 2 ** ((midi - 69) / 12);

  /** duração da resposta ao impulso do reverb (s) e constante de decaimento padrão; a −60 dB antes do fim */
  const IR_LEN = 3, IR_TAU = 0.42;
  /** release linear curto que fecha toda nota em zero exato (s) */
  const CLOSE = 0.02;

  function makeKit(ctx, o, rnd) {
    const sr = ctx.sampleRate;
    const L = o.loopLen;
    let latest = 0;
    const end = (t) => { if (t > latest) latest = t; };

    /** frequência arredondada para número inteiro de ciclos no loop (fonte contínua sem degrau na junção) */
    const freqLoop = (f) => Math.max(1, Math.round(f * L)) / L;

    /**
     * Soma determinística. O Chromium soma as várias conexões de uma mesma entrada numa ordem que varia entre
     * renderizações (medido: 20 osciladores na mesma entrada dão PCM diferente a cada render), e soma de ponto
     * flutuante não é associativa. Com no máximo 2 conexões por entrada a ordem não importa (a + b = b + a), então
     * toda mistura é uma corrente de GainNodes de ganho 1, cada um com 2 entradas: a voz nova e a corrente anterior.
     */
    const chains = [];
    const chain = (dest) => {
      let tail = null;
      const c = {
        add(node) { const g = ctx.createGain(); node.connect(g); if (tail) tail.connect(g); tail = g; },
        finish() { if (tail) tail.connect(dest); },
      };
      chains.push(c);
      return c;
    };

    // ---------- barramento mestre: seco + eco + reverb → passa-baixa "PS1" → passa-alta anti-DC → saída ----------
    const master = ctx.createGain();
    const masterSum = chain(master);
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 11000; lp.Q.value = 0.5;
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 28; hp.Q.value = 0.6;
    master.connect(lp).connect(hp).connect(ctx.destination);

    const reverb = ctx.createConvolver();
    reverb.normalize = false;
    const irN = Math.round(IR_LEN * sr);
    const ir = ctx.createBuffer(2, irN, sr);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      // reverb de "SPU": ruído com decaimento exponencial, um pouco escuro (média de 2 amostras) e com pré-atraso
      const pre = Math.round(0.018 * sr);
      let prev = 0;
      for (let i = pre; i < irN; i++) {
        const n = rnd() * 2 - 1;
        const v = (n + prev) * 0.5; prev = n;
        d[i] = v * Math.exp(-(i - pre) / sr / (o.reverbTau ?? IR_TAU));
      }
    }
    // energia unitária somando os 2 canais (o envio de cada voz decide o quanto de reverb entra)
    {
      let e = 0;
      for (let c = 0; c < 2; c++) for (const v of ir.getChannelData(c)) e += v * v;
      const k = 1 / Math.sqrt(e);
      for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < irN; i++) d[i] *= k; }
    }
    reverb.buffer = ir;
    const reverbSum = chain(reverb);
    const wet = ctx.createGain(); wet.gain.value = 1;
    reverb.connect(wet);
    masterSum.add(wet);

    // eco estéreo (ping-pong) em colcheia pontuada; realimentação < 0,4 para morrer dentro da cauda
    const echoIn = ctx.createGain();
    const echoSum = chain(echoIn);
    const dl = ctx.createDelay(2), dr = ctx.createDelay(2);
    dl.delayTime.value = o.echoTime; dr.delayTime.value = o.echoTime;
    const fb = ctx.createGain(); fb.gain.value = o.echoFeedback;
    const echoLp = ctx.createBiquadFilter(); echoLp.type = "lowpass"; echoLp.frequency.value = 3200;
    const merger = ctx.createChannelMerger(2);
    echoIn.connect(dl);
    dl.connect(echoLp).connect(dr);
    dr.connect(fb).connect(dl);
    dl.connect(merger, 0, 0); dr.connect(merger, 0, 1);
    const echoOut = ctx.createGain(); echoOut.gain.value = 0.55;
    merger.connect(echoOut);
    masterSum.add(echoOut); reverbSum.add(echoOut);

    /** saída de uma voz: pan + seco + envio ao reverb e ao eco */
    const out = (node, { pan = 0, rev = 0.3, echo = 0, dry = 1 } = {}) => {
      const p = ctx.createStereoPanner(); p.pan.value = pan;
      node.connect(p);
      const g = ctx.createGain(); g.gain.value = dry; p.connect(g); masterSum.add(g);
      if (rev) { const s = ctx.createGain(); s.gain.value = rev; p.connect(s); reverbSum.add(s); }
      if (echo) { const s = ctx.createGain(); s.gain.value = echo; p.connect(s); echoSum.add(s); }
    };

    /** envelope AR linear num AudioParam: 0 → pico em `a`, sustenta até `t + dur`, solta em `r` até 0 exato */
    const env = (param, t, dur, peak, a, r) => {
      param.setValueAtTime(0, t);
      param.linearRampToValueAtTime(peak, t + a);
      param.setValueAtTime(peak, t + Math.max(a, dur));
      param.linearRampToValueAtTime(0, t + Math.max(a, dur) + r);
      return t + Math.max(a, dur) + r;
    };
    /** envelope percussivo: ataque curto, decaimento exponencial, fecha em zero exato */
    const perc = (param, t, peak, a, decay, len) => {
      param.setValueAtTime(0, t);
      param.linearRampToValueAtTime(peak, t + a);
      param.setTargetAtTime(0, t + a, decay);
      param.setValueAtTime(peak * Math.exp(-(len - a) / decay), t + len);
      param.linearRampToValueAtTime(0, t + len + CLOSE);
      return t + len + CLOSE;
    };

    /** nota tonal: oscilador(es) → passa-baixa → envelope */
    function tone(t, dur, midi, opt = {}) {
      const { type = "triangle", gain = 0.1, a = 0.01, r = 0.3, cutoff = 4000, q = 0.7, detune = 0, voices = 1, decay = 0 } = opt;
      const f = mtof(midi);
      const filt = ctx.createBiquadFilter(); filt.type = "lowpass"; filt.frequency.value = cutoff; filt.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      filt.connect(g);
      const mix = chain(filt);
      let stop;
      if (decay) stop = perc(g.gain, t, gain, a, decay, dur);
      else stop = env(g.gain, t, dur, gain, a, r);
      for (let v = 0; v < voices; v++) {
        const osc = ctx.createOscillator(); osc.type = type;
        osc.frequency.value = f;
        osc.detune.value = voices > 1 ? (v / (voices - 1) - 0.5) * 2 * detune : 0;
        const vg = ctx.createGain(); vg.gain.value = 1 / voices;
        osc.connect(vg); mix.add(vg);
        osc.start(t); osc.stop(stop + 0.01);
      }
      end(stop);
      out(g, opt);
      return g;
    }

    /** caixa de música: seno + 2º e 3º harmônicos fracos, decaimento exponencial (frágil, sem ataque duro) */
    function bell(t, midi, opt = {}) {
      const { gain = 0.08, decay = 0.9, len = 2.4 } = opt;
      const f = mtof(midi);
      const g = ctx.createGain(); g.gain.value = 0;
      const stop = perc(g.gain, t, gain, 0.006, decay, len);
      const mix = chain(g);
      [[1, 1], [2, 0.28], [3, 0.08]].forEach(([h, amp]) => {
        const osc = ctx.createOscillator(); osc.type = "sine"; osc.frequency.value = f * h;
        const hg = ctx.createGain(); hg.gain.value = amp;
        osc.connect(hg); mix.add(hg);
        osc.start(t); osc.stop(stop + 0.01);
      });
      end(stop);
      out(g, opt);
    }

    /** bumbo/batimento: seno com queda de afinação e decaimento curto */
    function kick(t, opt = {}) {
      const { f0 = 110, f1 = 42, gain = 0.5, decay = 0.09, len = 0.35, drop = 0.06, cutoff = 900 } = opt;
      const osc = ctx.createOscillator(); osc.type = "sine";
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(f1, t + drop);
      const filt = ctx.createBiquadFilter(); filt.type = "lowpass"; filt.frequency.value = cutoff;
      const g = ctx.createGain(); g.gain.value = 0;
      const stop = perc(g.gain, t, gain, 0.003, decay, len);
      osc.connect(filt).connect(g);
      osc.start(t); osc.stop(stop + 0.01);
      end(stop);
      out(g, { rev: 0.08, ...opt });
    }

    // ruído branco do PRNG: um buffer curto para percussão (lido de pontos variados) e um do tamanho do loop
    const hitNoise = ctx.createBuffer(1, sr, sr);
    { const d = hitNoise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1; }

    /** golpe de ruído filtrado (chimbal, caixa sintética, sopro) */
    function noiseHit(t, opt = {}) {
      const { type = "highpass", freq = 7000, q = 0.7, gain = 0.1, decay = 0.03, len = 0.12, a = 0.002 } = opt;
      const src = ctx.createBufferSource(); src.buffer = hitNoise;
      const filt = ctx.createBiquadFilter(); filt.type = type; filt.frequency.value = freq; filt.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      const stop = perc(g.gain, t, gain, a, decay, len);
      src.connect(filt).connect(g);
      const offset = Math.floor(rnd() * (sr / 2)) / sr;
      src.start(t, offset); src.stop(stop + 0.01);
      end(stop);
      out(g, opt);
    }

    /** curva periódica de L segundos para setValueCurveAtTime (amostrada em `n` pontos, fecha no 1º valor) */
    const curve = (fn, n = 2048) => {
      const c = new Float32Array(n + 1);
      for (let i = 0; i <= n; i++) c[i] = fn(i / n);
      return c;
    };

    /** fonte contínua de 0 a L: drone com número inteiro de ciclos; tremolo opcional com `trem` ciclos por loop */
    function drone(midi, opt = {}) {
      const { type = "sine", gain = 0.1, cutoff = 2000, cents = 0, trem = 0, tremDepth = 0, tremPhase = 0, swell = null } = opt;
      const osc = ctx.createOscillator(); osc.type = type;
      osc.frequency.value = freqLoop(mtof(midi) * 2 ** (cents / 1200));
      const filt = ctx.createBiquadFilter(); filt.type = "lowpass"; filt.frequency.value = cutoff; filt.Q.value = 0.5;
      const g = ctx.createGain(); g.gain.value = gain;
      if (trem) g.gain.setValueCurveAtTime(curve(u => gain * (1 - tremDepth * 0.5 * (1 - Math.cos(2 * Math.PI * (trem * u + tremPhase))))), 0, L);
      if (swell) g.gain.setValueCurveAtTime(curve(u => gain * swell(u)), 0, L);
      osc.connect(filt).connect(g);
      osc.start(0); osc.stop(L);
      end(L);
      out(g, opt);
    }

    /** vento: ruído (buffer do tamanho do loop) em passa-faixa com centro varrido por `cycles` ciclos por loop */
    function wind(opt = {}) {
      const { gain = 0.2, freq = 500, q = 0.9, cycles = 1, depth = 1, type = "bandpass", phase = 0, gainCycles = 0, gainDepth = 0 } = opt;
      const n = Math.round(L * sr);
      const b = ctx.createBuffer(1, n, sr);
      const d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = rnd() * 2 - 1;
      const src = ctx.createBufferSource(); src.buffer = b;
      const filt = ctx.createBiquadFilter(); filt.type = type; filt.Q.value = q; filt.frequency.value = freq;
      filt.frequency.setValueCurveAtTime(curve(u => freq * 2 ** (depth * Math.sin(2 * Math.PI * (cycles * u + phase)))), 0, L);
      const g = ctx.createGain(); g.gain.value = gain;
      if (gainCycles) g.gain.setValueCurveAtTime(curve(u => gain * (1 - gainDepth * 0.5 * (1 - Math.cos(2 * Math.PI * gainCycles * u)))), 0, L);
      src.connect(filt).connect(g);
      src.start(0); src.stop(L);
      end(L);
      out(g, opt);
    }

    /**
     * Glissando de Shepard–Risset: `k` parciais em oitavas sobem uma oitava por loop; amplitude em janela de Hann na
     * escala log de frequência, zero nas pontas. f0 é escolhido para a fase de cada parcial ao fim do loop
     * (f0·2^i·L/ln 2 ciclos) ser inteira: a parcial i termina exatamente onde a i+1 começou (sobe sem fim, sem degrau).
     */
    function shepard(midi, opt = {}) {
      const { k = 7, gain = 0.1, type = "sine", cutoff = 3000 } = opt;
      const per = L / Math.LN2;
      const f0 = Math.max(1, Math.round(mtof(midi) * per)) / per;
      const filt = ctx.createBiquadFilter(); filt.type = "lowpass"; filt.frequency.value = cutoff; filt.Q.value = 0.5;
      const bus = ctx.createGain(); bus.gain.value = gain;
      filt.connect(bus);
      const mix = chain(filt);
      for (let i = 0; i < k; i++) {
        const osc = ctx.createOscillator(); osc.type = type;
        osc.frequency.setValueAtTime(f0 * 2 ** i, 0);
        osc.frequency.exponentialRampToValueAtTime(f0 * 2 ** (i + 1), L);
        const g = ctx.createGain(); g.gain.value = 0;
        g.gain.setValueCurveAtTime(curve(u => Math.sin(Math.PI * (i + u) / k) ** 2), 0, L);
        osc.connect(g); mix.add(g);
        osc.start(0); osc.stop(L);
      }
      end(L);
      out(bus, opt);
    }

    /** fecha as correntes de soma (chamar depois de escrever a partitura, antes de renderizar) */
    const finish = () => { for (const c of chains) c.finish(); };

    return { tone, bell, kick, noiseHit, drone, wind, shepard, finish, latest: () => latest };
  }

  // =====================================================================================================================
  // Partituras. Alturas em semitons a partir da tônica na oitava 2 (D2 em Ré menor): 0 = D2, 12 = D3, 24 = D4, 36 = D5;
  // graus do menor: 0 1ª, 2 2ª, 3 3ªm, 5 4ª, 7 5ª, 8 6ªm, 10 7ªm (11 = sensível, 1 = 2ª menor/dissonância).
  // t(bar, beat) = início em segundos.
  // =====================================================================================================================
  const SCORES = {
    // Ambiente: drone grave de Ré (D1 + D2 com batimento lento), quinta fantasma, vento filtrado e raros sinos de vidro
    // muito ao fundo. Quase sem pulso: nada cai no tempo forte de forma marcada.
    ambient: { reverbTau: 0.55, echoBeats: 1.5, echoFeedback: 0.35, write(k, n, t, o) {
      k.drone(n(-12), { gain: 0.34, cutoff: 300, rev: 0.1, trem: 1, tremDepth: 0.25 });
      k.drone(n(0), { type: "triangle", gain: 0.11, cutoff: 420, cents: -4, pan: -0.35, rev: 0.25, trem: 2, tremDepth: 0.35 });
      k.drone(n(0), { type: "triangle", gain: 0.11, cutoff: 420, cents: 4, pan: 0.35, rev: 0.25, trem: 2, tremDepth: 0.35, tremPhase: 0.5 });
      k.drone(n(7), { type: "sine", gain: 0.05, cutoff: 900, pan: 0.15, rev: 0.4, trem: 1, tremDepth: 0.9, tremPhase: 0.25 });
      k.wind({ gain: 0.26, freq: 420, q: 1.1, cycles: 1, depth: 0.9, pan: -0.2, rev: 0.3 });
      k.wind({ gain: 0.05, freq: 2600, q: 2.5, cycles: 3, depth: 0.6, phase: 0.3, pan: 0.3, rev: 0.4, gainCycles: 2, gainDepth: 0.8 });
      const glass = [[0, 2.5, 31], [2, 1, 39], [4, 3, 36], [6, 1.5, 38]];
      for (const [bar, beat, s] of glass) k.tone(t(bar, beat), 1.2, n(s), { type: "sine", gain: 0.035, a: 0.9, r: 2.2, cutoff: 3000, pan: (bar / o.loopBars - 0.4), rev: 0.8, echo: 0.4 });
    } },

    // Tensão: o drone do ambiente mais escuro, batimento grave "tum-tum" em todo tempo, 2ª menor (Ré contra Mi bemol)
    // que cresce e some uma vez por loop, vento mais grave e próximo.
    tension: { reverbTau: 0.45, echoBeats: 1.5, echoFeedback: 0.3, write(k, n, t, o) {
      k.drone(n(-12), { gain: 0.3, cutoff: 260, rev: 0.1 });
      k.drone(n(0), { type: "triangle", gain: 0.09, cutoff: 380, cents: -5, pan: -0.3, rev: 0.2 });
      k.drone(n(0), { type: "triangle", gain: 0.09, cutoff: 380, cents: 5, pan: 0.3, rev: 0.2 });
      k.drone(n(12), { type: "sawtooth", gain: 0.03, cutoff: 700, pan: -0.25, rev: 0.4, trem: 2, tremDepth: 0.5 });
      k.drone(n(13), { type: "sawtooth", gain: 0.032, cutoff: 700, pan: 0.25, rev: 0.4, swell: u => 0.5 * (1 - Math.cos(2 * Math.PI * u)) });
      k.wind({ gain: 0.2, freq: 300, q: 1.3, cycles: 2, depth: 0.7, rev: 0.25 });
      for (let b = 0; b < o.loopBars * o.beatsPerBar; b++) {
        const tt = t(0, b);
        k.kick(tt, { f0: 70, f1: 38, gain: 0.55, decay: 0.07, len: 0.3, drop: 0.08, cutoff: 220 });
        k.kick(tt + 0.2, { f0: 62, f1: 36, gain: 0.32, decay: 0.06, len: 0.25, drop: 0.07, cutoff: 200 });
      }
      // agulhas agudas raras, em 2ª menor, no fim das frases
      for (const [bar, beat] of [[1, 3.5], [3, 3], [5, 3.5], [7, 2.5]]) {
        k.tone(t(bar, beat), 0.4, n(36), { type: "sine", gain: 0.02, a: 0.3, r: 1.2, pan: -0.5, rev: 0.7, echo: 0.3 });
        k.tone(t(bar, beat) + 0.05, 0.4, n(37), { type: "sine", gain: 0.018, a: 0.3, r: 1.2, pan: 0.5, rev: 0.7, echo: 0.3 });
      }
    } },

    // Perseguição: subdivisão dobrada (colcheias no baixo, semicolcheias no ostinato), bumbo e caixa sintéticos,
    // chimbal em colcheias; ostinato em Ré menor com Mi bemol de passagem.
    chase: { reverbTau: 0.3, echoBeats: 0.75, echoFeedback: 0.25, write(k, n, t, o) {
      k.drone(n(-12), { gain: 0.2, cutoff: 200, rev: 0.05 });
      k.wind({ gain: 0.07, freq: 900, q: 0.8, cycles: 4, depth: 0.8, rev: 0.2 });
      const bassA = [0, 0, 12, 0, 1, 0, 12, 3], bassB = [0, 0, 12, 0, -2, -2, 10, 1];
      const arpA = [24, 27, 31, 36, 31, 27, 24, 27, 25, 27, 31, 37, 31, 27, 25, 27];
      const arpB = [22, 26, 29, 34, 29, 26, 22, 26, 25, 29, 31, 35, 31, 29, 25, 29];
      for (let bar = 0; bar < o.loopBars; bar++) {
        const bass = bar % 4 < 2 ? bassA : bassB;
        bass.forEach((s, i) => k.tone(t(bar, i / 2), 0.2, n(s), { type: "square", gain: 0.085, a: 0.005, r: 0.08, cutoff: 650, q: 2, rev: 0.05 }));
        const arp = bar % 4 < 2 ? arpA : arpB;
        arp.forEach((s, i) => k.tone(t(bar, i / 4), 0.06, n(s), { type: "square", gain: 0.03, a: 0.003, r: 0.08, cutoff: 2200, pan: i % 2 ? 0.35 : -0.35, rev: 0.15, echo: 0.25 }));
        for (let b = 0; b < o.beatsPerBar; b++) {
          if (b % 2 === 0) k.kick(t(bar, b), { gain: 0.6 });
          if (b === 2) k.kick(t(bar, b + 0.75), { gain: 0.35 });
          if (b % 2 === 1) {
            k.noiseHit(t(bar, b), { type: "bandpass", freq: 1700, q: 0.8, gain: 0.32, decay: 0.05, len: 0.2, rev: 0.25 });
            k.tone(t(bar, b), 0.12, n(17), { type: "triangle", gain: 0.12, a: 0.002, decay: 0.04, cutoff: 1200 });
          }
          for (let e = 0; e < 2; e++) k.noiseHit(t(bar, b + e / 2), { freq: 7500, gain: e ? 0.09 : 0.05, decay: 0.018, len: 0.06, pan: 0.25, rev: 0.1 });
        }
      }
    } },

    // Pressão final: mais denso e agudo. Glissando de Shepard que sobe sem parar (crescendo constante sem degrau no
    // loop), acorde em dente de serra que cresce a cada compasso, semicolcheias agudas, bumbo em todo tempo,
    // chimbal em semicolcheias.
    final_pressure: { reverbTau: 0.32, echoBeats: 0.75, echoFeedback: 0.28, write(k, n, t, o) {
      k.drone(n(-12), { gain: 0.18, cutoff: 220, rev: 0.05 });
      k.shepard(n(-12), { k: 7, gain: 0.07, type: "triangle", cutoff: 3500, rev: 0.35 });
      const chords = [[12, 24, 27, 31], [12, 24, 25, 31], [10, 22, 26, 29], [11, 23, 26, 31]];
      const ost = [36, 39, 43, 39, 37, 39, 43, 48, 36, 39, 43, 39, 37, 40, 43, 46];
      for (let bar = 0; bar < o.loopBars; bar++) {
        const ch = chords[Math.floor(bar / 2) % chords.length];
        const barLen = t(1, 0) - t(0, 0);
        for (const s of ch) {
          // crescendo dentro do compasso: entra baixo e chega ao pico no tempo forte seguinte
          k.tone(t(bar, 0), barLen - 0.08, n(s), { type: "sawtooth", gain: 0.022, a: barLen - 0.08, r: 0.1, cutoff: 1800, voices: 2, detune: 9, pan: (s % 2 ? 0.3 : -0.3), rev: 0.3 });
        }
        ost.forEach((s, i) => k.tone(t(bar, i / 4), 0.05, n(s), { type: "square", gain: 0.026, a: 0.002, r: 0.06, cutoff: 3200, pan: i % 2 ? 0.4 : -0.4, rev: 0.15, echo: 0.2 }));
        for (let e = 0; e < 8; e++) k.tone(t(bar, e / 2), 0.12, n(e % 2 ? 12 : 0), { type: "square", gain: 0.07, a: 0.003, r: 0.06, cutoff: 600, q: 3, rev: 0.03 });
        for (let b = 0; b < o.beatsPerBar; b++) {
          k.kick(t(bar, b), { gain: 0.55 });
          if (b % 2 === 1) k.noiseHit(t(bar, b), { type: "bandpass", freq: 1900, q: 0.8, gain: 0.3, decay: 0.05, len: 0.2, rev: 0.3 });
          for (let s = 0; s < 4; s++) k.noiseHit(t(bar, b + s / 4), { freq: 8000, gain: s === 2 ? 0.08 : 0.04, decay: 0.014, len: 0.05, pan: -0.25, rev: 0.1 });
        }
      }
    } },

    // Resgate: motivo de caixa de música frágil sobre acordes Rém – Si♭ – Fá – Lá (dominante maior: esperança tensa,
    // a frase termina suspensa na sensível); quinta aberta no grave e pulso suave a cada meio compasso.
    rescue: { reverbTau: 0.6, echoBeats: 0.75, echoFeedback: 0.32, write(k, n, t, o) {
      k.drone(n(0), { type: "triangle", gain: 0.1, cutoff: 350, rev: 0.2, trem: 2, tremDepth: 0.3 });
      k.drone(n(7), { type: "sine", gain: 0.05, cutoff: 600, rev: 0.3, trem: 4, tremDepth: 0.4 });
      k.wind({ gain: 0.06, freq: 1200, q: 1.2, cycles: 1, depth: 0.7, rev: 0.4 });
      const pads = [[12, 15, 19], [8, 12, 15], [15, 19, 22], [19, 23, 26]];
      const barLen = t(1, 0) - t(0, 0);
      pads.forEach((ch, i) => ch.forEach((s, j) => k.tone(t(i * 2, 0), 2 * barLen - 0.6, n(s), {
        type: "triangle", gain: 0.035, a: 0.9, r: 1.2, cutoff: 1100, voices: 2, detune: 6, pan: (j - 1) * 0.4, rev: 0.5,
      })));
      const mel = [
        [0, 0, 31], [0, 1, 36], [0, 2, 39],
        [1, 0, 38], [1, 1.5, 36], [1, 2, 31],
        [2, 0, 32], [2, 1, 36], [2, 2, 39], [2, 3, 41],
        [3, 0, 39], [3, 2.5, 38], [3, 3, 36],
        [4, 0, 34], [4, 1, 39], [4, 2, 43],
        [5, 0, 41], [5, 1, 39], [5, 2, 38], [5, 3, 34],
        [6, 0, 35], [6, 1, 38], [6, 2, 43],
        [7, 0, 38], [7, 2, 35],
      ];
      for (const [bar, beat, s] of mel) k.bell(t(bar, beat), n(s), { gain: 0.075, decay: 0.8, len: 2.2, pan: 0.15, rev: 0.55, echo: 0.35 });
      for (let h = 0; h < o.loopBars * 2; h++) k.kick(t(0, h * 2), { f0: 60, f1: 40, gain: 0.25, decay: 0.08, len: 0.3, drop: 0.08, cutoff: 180 });
    } },
  };

  const toB64 = (f32) => {
    const u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
    let s = "";
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  };

  /**
   * Renderiza um stem e devolve o PCM do loop já com a cauda somada no início.
   * o = { sampleRate, bpm, beatsPerBar, loopBars, tailBars, seed, key }
   */
  async function renderStem(name, o) {
    const score = SCORES[name];
    if (!score) throw new Error(`stem sem partitura: ${name}`);
    const beat = 60 / o.bpm, bar = beat * o.beatsPerBar;
    const loopLen = bar * o.loopBars, tailLen = bar * o.tailBars;
    const Ls = Math.round(loopLen * o.sampleRate), Ts = Math.round(tailLen * o.sampleRate);
    if (Math.abs(Ls - loopLen * o.sampleRate) > 1e-6) throw new Error(`loop de ${loopLen} s não dá número inteiro de amostras a ${o.sampleRate} Hz`);
    if (Ts > Ls) throw new Error("cauda maior que o loop");
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Ls + Ts, sampleRate: o.sampleRate });
    // semente por stem: a do YAML combinada com o índice do nome (cada stem tem ruído próprio, mas reprodutível)
    let h = o.seed >>> 0;
    for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
    const rnd = mulberry32(h);
    const opts = { ...o, loopLen, echoTime: beat * score.echoBeats, echoFeedback: score.echoFeedback, reverbTau: score.reverbTau };
    const kit = makeKit(ctx, opts, rnd);
    const tonic = tonicMidi(o.key);
    score.write(kit, (s) => tonic + s, (b, bt) => b * bar + bt * beat, opts);
    kit.finish();
    // tudo tem de terminar (com reverb, eco e filtros) dentro da cauda: o wrap só é exato assim
    const need = kit.latest() + IR_LEN + 1;
    if (need > loopLen + tailLen) throw new Error(`${name}: cauda insuficiente (precisa de ${need.toFixed(2)} s, há ${(loopLen + tailLen).toFixed(2)} s)`);
    const buf = await ctx.startRendering();
    const chans = [];
    let tailPeak = 0, peak = 0, tailAt = 0;
    const lastN = Math.round(0.25 * o.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; if (i >= d.length - lastN && a > tailPeak) { tailPeak = a; tailAt = i / o.sampleRate; } }
      const r = new Float32Array(Ls);
      r.set(d.subarray(0, Ls));
      for (let i = 0; i < Ts; i++) r[i] += d[Ls + i];
      chans.push(toB64(r));
    }
    return { name, length: Ls, channels: chans, renderedPeak: peak, tailEndPeak: tailPeak, tailAt, latestEvent: kit.latest() };
  }

  globalThis.renderStem = renderStem;
})();
