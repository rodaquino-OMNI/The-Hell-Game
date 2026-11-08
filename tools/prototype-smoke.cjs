// Teste de fumaça do protótipo: abre prototype/the-hell.html no Chromium (SwiftShader), inicia a partida, anda 4 s e confere estado e erros.
/* global THREE, G -- variáveis globais da página do protótipo, lidas dentro de page.evaluate */
// Uso: node tools/prototype-smoke.cjs <saida.png>  (requer playwright)
const { chromium } = require('playwright');
(async () => { const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist'] }); const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto('file://' + require('path').resolve(__dirname, '../prototype/the-hell.html'), { waitUntil: 'load', timeout: 60000 });
console.log('THREE loaded:', await p.evaluate(() => typeof THREE !== 'undefined' && THREE.REVISION));
await p.click('#go'); await p.keyboard.down('KeyW'); await p.waitForTimeout(4000); await p.keyboard.up('KeyW');
const st = await p.evaluate(() => ({ t: G.t.toFixed(1), z: G.P.z.toFixed(1), gens: G.gens.length, bonus: G.bg.length, hunterHp: G.h.hp, top: document.getElementById('top').innerText.slice(0,80) }));
console.log(JSON.stringify(st)); await p.screenshot({ path: process.argv[2] }); console.log('errors:', errs); await b.close(); if (errs.length) process.exit(1); })();
