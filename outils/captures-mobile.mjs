// Captures de l'app mobile : 4 thèmes x clair/sombre x téléphone/ordi x 7 écrans (+ démarrage).
// Usage : node outils/captures-mobile.mjs [baseURL] [dossier] [themes,separes,par,virgules]
// Playwright pris (lecture seule) dans node_modules de rawlf-app-nekhevi. Fausse caméra : outils/_camera/recu.mjpeg.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire('C:/DEV/CODEGOD/RAWLF/rawlf/rawlf-app-nekhevi/package.json');
const { chromium } = require('@playwright/test');

const [base = 'http://localhost:4300', OUT = 'C:/Users/nivoi/Downloads/NEKHEVI-REVUE/NCAPTURE/mobile', filtre] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const THEMES = (filtre || 'editorial,instrument,verre,bento').split(',');
const MODES = ['dark', 'light'];
const VPS = {
  telephone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  ordi: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};
const cam = path.resolve(import.meta.dirname, '_camera', 'recu.mjpeg');
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + cam] });
const erreurs = [];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function contexte(vp, mode, splash) {
  const ctx = await browser.newContext({ ...VPS[vp], colorScheme: mode, permissions: ['camera'], locale: 'fr-CA' });
  if (!splash) await ctx.addInitScript(() => { try { sessionStorage.setItem('nk-splash', '1'); } catch {} });
  return ctx;
}
function suivre(page, nom) {
  page.on('pageerror', (e) => erreurs.push(nom + ' : ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') erreurs.push(nom + ' (console) : ' + m.text()); });
}
async function nav(page, v) { await page.click(`nav#nav button[data-v="${v}"]`); await pause(350); }

for (const vp of Object.keys(VPS)) {
  { // écran de démarrage (identique pour tous les thèmes)
    const ctx = await contexte(vp, 'dark', true); const page = await ctx.newPage(); suivre(page, vp + ' splash');
    await page.goto(base + '/capture?theme=instrument&mode=dark'); await pause(250);
    await page.screenshot({ path: `${OUT}/${vp}-demarrage.png` }); await ctx.close();
  }
  for (const th of THEMES) for (const mode of MODES) {
    const nom = `${vp}-${th}-${mode === 'dark' ? 'sombre' : 'clair'}`;
    const ctx = await contexte(vp, mode); const page = await ctx.newPage(); suivre(page, nom);
    let lent = true;
    await page.route('**/api/lire', async (r) => { if (lent) await pause(4000); await r.continue(); });
    await page.goto(`${base}/capture?theme=${th}&mode=${mode}`);
    await page.addStyleTag({ content: '.toast{display:none!important}' });
    await page.evaluate(() => document.fonts.ready); await pause(500);
    await page.screenshot({ path: `${OUT}/${nom}-1-accueil.png` });
    await page.click('#bCam'); await page.waitForFunction(() => { const v = document.querySelector('.vf video'); return v && v.videoWidth > 0; }, null, { timeout: 8000 }).catch(() => {});
    await pause(700); await page.screenshot({ path: `${OUT}/${nom}-2-capture.png` });
    await page.click('#vfX'); await pause(200);
    await page.click('#bDemo'); await pause(900);
    await page.locator('.item.lecture').first().click(); await pause(600);
    await page.screenshot({ path: `${OUT}/${nom}-3-lecture.png` });
    lent = false;
    await page.waitForFunction(() => !document.querySelector('.item.lecture'), null, { timeout: 15000 });
    await page.keyboard.press('Escape'); await pause(300);
    await page.locator('.item', { hasText: 'Bistro' }).first().click(); await pause(500);
    await page.screenshot({ path: `${OUT}/${nom}-4-correction.png` });
    await page.keyboard.press('Escape'); await pause(200);
    for (const f of ['Petro', 'RONA']) { await page.locator('.item', { hasText: f }).first().click(); await pause(250); await page.click('#bOk'); await pause(250); }
    await nav(page, 'approuvees'); await page.screenshot({ path: `${OUT}/${nom}-5-approbation.png` });
    await nav(page, 'exporter'); await page.screenshot({ path: `${OUT}/${nom}-6-export.png` });
    await nav(page, 'reglages'); await page.screenshot({ path: `${OUT}/${nom}-7-reglages.png` });
    await ctx.close();
    console.log('ok', nom);
  }
}
await browser.close();
writeFileSync(`${OUT}/erreurs.txt`, erreurs.join('\n') || 'Aucune erreur navigateur.');
console.log(erreurs.length ? erreurs.join('\n') : 'Aucune erreur navigateur.');
