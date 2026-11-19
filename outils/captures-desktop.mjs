// Captures de l'app locale (desktop) : 4 thèmes x clair/sombre x téléphone/ordi x 7 écrans.
// Usage : node outils/captures-desktop.mjs [baseURL] [dossier] [themes,separes,par,virgules]
// Le serveur doit tourner sur une COPIE de desktop\ (l'état est remis à zéro à chaque combinaison)
// et sans NBooks prêt (NBOOKS_PRET vers un fichier absent) : rien n'est envoyé à NBooks.
// Playwright pris (lecture seule) dans node_modules de rawlf-app-nekhevi. Fausse caméra : outils/_camera/recu.mjpeg.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire('C:/DEV/CODEGOD/RAWLF/rawlf/rawlf-app-nekhevi/package.json');
const { chromium } = require('@playwright/test');

const [base = 'http://localhost:4110', OUT = 'C:/Users/nivoi/Downloads/NEKHEVI-REVUE/NCAPTURE/desktop', filtre] = process.argv.slice(2);
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
function suivre(page, nom) {
  page.on('pageerror', (e) => erreurs.push(nom + ' : ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') erreurs.push(nom + ' (console) : ' + m.text()); });
}
async function nav(page, v) { await page.click(`nav#nav button[data-v="${v}"]`); await pause(400); }

for (const vp of Object.keys(VPS)) for (const th of THEMES) for (const mode of MODES) {
  const nom = `${vp}-${th}-${mode === 'dark' ? 'sombre' : 'clair'}`;
  const ctx = await browser.newContext({ ...VPS[vp], colorScheme: mode, permissions: ['camera'], locale: 'fr-CA' });
  await ctx.addInitScript(() => { try { sessionStorage.setItem('nk-splash', '1'); } catch {} });
  const page = await ctx.newPage(); suivre(page, nom);
  await page.request.post(base + '/api/reset');
  await page.route('**/complete', async (r) => { await pause(3500); await r.continue(); });
  await page.goto(`${base}/?theme=${th}&mode=${mode}`);
  await page.addStyleTag({ content: '.toast{display:none!important}' });
  await page.evaluate(() => document.fonts.ready); await pause(600);
  await page.screenshot({ path: `${OUT}/${nom}-1-accueil.png` });
  await page.click('#bCam'); await page.waitForFunction(() => { const v = document.querySelector('.vf video'); return v && v.videoWidth > 0; }, null, { timeout: 8000 }).catch(() => {});
  await pause(700); await page.screenshot({ path: `${OUT}/${nom}-2-capture.png` });
  await page.click('#vfX'); await pause(200);
  await page.click('#bDemo');
  await page.waitForFunction(() => document.querySelectorAll('.item[data-id]').length >= 3 && !document.querySelector('.busy'), null, { timeout: 30000 });
  await pause(400);
  // Lecture : 2e photo d'une facture (« Reprendre une photo pour compléter »), balayage or pendant la lecture
  await page.locator('.item[data-id]').first().click(); await pause(400);
  await page.click('#bRe'); await page.waitForFunction(() => { const v = document.querySelector('.vf.on video'); return v && v.videoWidth > 0; }, null, { timeout: 8000 }).catch(() => {});
  await pause(400); await page.click('#vfShot'); await pause(900);
  await page.screenshot({ path: `${OUT}/${nom}-3-lecture.png` });
  await page.waitForFunction(() => !document.querySelector('#phBig.scan'), null, { timeout: 15000 }).catch(() => {});
  await page.keyboard.press('Escape'); await pause(300);
  await page.locator('.item[data-id]').nth(1).click(); await pause(500);
  await page.screenshot({ path: `${OUT}/${nom}-4-correction.png` });
  await page.keyboard.press('Escape'); await pause(300);
  for (let k = 0; k < 2; k++) {
    await page.locator('.list').first().locator('.item[data-id]').first().click(); await pause(300);
    if (await page.locator('#bOk').count()) { await page.click('#bOk'); await pause(700); } else { await page.keyboard.press('Escape'); }
  }
  await nav(page, 'approuvees'); await page.screenshot({ path: `${OUT}/${nom}-5-approbation.png` });
  await nav(page, 'exporter'); await page.screenshot({ path: `${OUT}/${nom}-6-export.png` });
  await nav(page, 'reglages'); await page.screenshot({ path: `${OUT}/${nom}-7-reglages.png` });
  await ctx.close();
  console.log('ok', nom);
}
await browser.close();
writeFileSync(`${OUT}/erreurs.txt`, erreurs.join('\n') || 'Aucune erreur navigateur.');
console.log(erreurs.length ? erreurs.join('\n') : 'Aucune erreur navigateur.');
