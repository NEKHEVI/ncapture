/* NCapture : interface commune (thèmes, réglages, viseur, démarrage). AGPL-3.0.
 * Source unique : shared/ (copié dans mobile/ et desktop/rbcapture/static/assets/ par outils/synchroniser.ps1).
 * Thèmes : mêmes noms et même logique que l'app NEKHEVI (src/lib/nk-theme.ts) : editorial, instrument
 * (défaut), verre, bento ; toute valeur inconnue retombe sur « instrument ». Mode clair / sombre séparé.
 */
(function () {
  "use strict";
  var THEMES = [
    { id: "editorial", nom: "Éditorial noir", ds: "Grand chiffre à empattements, filets dorés, sans cartes." },
    { id: "instrument", nom: "Instrument", ds: "Chiffres en chasse fixe, règles graduées, touches physiques." },
    { id: "verre", nom: "Verre et lumière", ds: "Verre dépoli, une lumière dorée derrière la vedette." },
    { id: "bento", nom: "Bento audacieux", ds: "Tuiles, la vedette en bloc or plein, une touche crème." }
  ];
  var DEFAUT = "instrument", K_THEME = "nk-theme", K_MODE = "nk-mode", K_MOTION = "nk-motion";
  var root = document.documentElement;
  function lire(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function ecrire(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function resoudre(v) { return THEMES.some(function (t) { return t.id === v; }) ? v : DEFAUT; }
  function theme() { return resoudre(root.getAttribute("data-nk-theme") || lire(K_THEME)); }
  function mode() { var m = lire(K_MODE) || lire("rbooks-theme"); return m === "light" || m === "dark" ? m : "system"; }
  function sombre() { var m = mode(); return m === "system" ? matchMedia("(prefers-color-scheme: dark)").matches : m === "dark"; }
  function majMeta() {
    var c = getComputedStyle(document.body || root).backgroundColor || (sombre() ? "#0B0B0C" : "#F5F4F1");
    document.querySelectorAll('meta[name="theme-color"]').forEach(function (m) { m.setAttribute("content", c); m.removeAttribute("media"); });
  }
  function appliquer() {
    root.setAttribute("data-nk-theme", theme());
    var m = mode(); if (m === "system") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", m);
    if (lire(K_MOTION) === "reduce") root.setAttribute("data-motion", "reduce"); else root.removeAttribute("data-motion");
    requestAnimationFrame(majMeta);
  }
  function choisirTheme(v) { ecrire(K_THEME, resoudre(v)); root.setAttribute("data-nk-theme", resoudre(v)); appliquer(); }
  function choisirMode(v) { ecrire(K_MODE, v === "light" || v === "dark" ? v : "system"); appliquer(); }
  function mouvementReduit() { return lire(K_MOTION) === "reduce" || matchMedia("(prefers-reduced-motion: reduce)").matches; }
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { requestAnimationFrame(majMeta); });

  var I = {
    cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.6"/></svg>',
    img: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="9" cy="9.5" r="1.6"/><path d="M20 15l-4.5-4.5L6 20"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    arr: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
    ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 5h5v5M19 5l-8 8M18 14v5H5V6h5"/></svg>',
    reg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>'
  };

  /* ---- Vue Réglages (même contenu dans les deux apps, plus un bloc propre à chacune) ---- */
  function vueReglages(o) {
    o = o || {};
    var t = theme(), m = mode(), red = lire(K_MOTION) === "reduce";
    var cartes = THEMES.map(function (x) {
      return '<button type="button" class="th" role="radio" data-nk-theme="' + x.id + '" data-th="' + x.id + '" aria-checked="' + (x.id === t) + '">' +
        '<span class="mini" aria-hidden="true"><i class="h"></i><i></i><i class="k"></i></span>' +
        '<span class="nm">' + x.nom + '</span><span class="ds">' + x.ds + '</span><span class="ok" aria-hidden="true">' + I.ok + '</span></button>';
    }).join("");
    var seg = [["system", "Système"], ["light", "Clair"], ["dark", "Sombre"]].map(function (x) {
      return '<button type="button" role="radio" data-mode="' + x[0] + '" aria-checked="' + (x[0] === m) + '">' + x[1] + '</button>';
    }).join("");
    return '<p class="eyebrow">Réglages</p><h1>Apparence</h1><p class="sub">Les mêmes quatre thèmes que l’app NEKHEVI. Le choix reste sur cet appareil.</p>' +
      '<div class="themes" role="radiogroup" aria-label="Thème">' + cartes + '</div>' +
      '<div class="sec">Mode</div><div class="seg" role="radiogroup" aria-label="Mode clair ou sombre">' + seg + '</div>' +
      '<div class="card" style="margin-top:12px"><div class="sw"><div class="t">Mouvement réduit<small>Coupe le balayage et les animations (le système peut déjà le demander).</small></div>' +
      '<button type="button" class="tg" id="nkMotion" role="switch" aria-checked="' + red + '" aria-label="Mouvement réduit"></button></div></div>' +
      (o.extra || "") +
      '<div class="sec">À propos</div><div class="card"><div class="about"><img src="' + (o.icone || "/icon-192.png") + '" alt="">' +
      '<div><b>NCapture</b><div class="note" style="margin:2px 0 0">' + (o.version || "") + ' Compagnon de NBooks. Logiciel libre sous licence AGPL-3.0, fourni tel quel, sans garantie.</div></div></div>' +
      '<div class="links"><a class="lnk" href="' + (o.source || "https://github.com/NEKHEVI/ncapture") + '" target="_blank" rel="noopener">' + I.ext + 'Code source</a>' +
      '<a class="lnk" href="' + (o.licence || "/LICENSE") + '" target="_blank" rel="noopener">Licence AGPL-3.0</a></div></div>';
  }
  function lierReglages(apres) {
    document.querySelectorAll("[data-th]").forEach(function (b) {
      b.onclick = function () { choisirTheme(b.dataset.th); document.querySelectorAll("[data-th]").forEach(function (x) { x.setAttribute("aria-checked", x === b); }); if (apres) apres(); };
    });
    document.querySelectorAll("[data-mode]").forEach(function (b) {
      b.onclick = function () { choisirMode(b.dataset.mode); document.querySelectorAll("[data-mode]").forEach(function (x) { x.setAttribute("aria-checked", x === b); }); if (apres) apres(); };
    });
    var s = document.getElementById("nkMotion");
    if (s) s.onclick = function () { var on = s.getAttribute("aria-checked") !== "true"; ecrire(K_MOTION, on ? "reduce" : "system"); s.setAttribute("aria-checked", on); appliquer(); };
    radioClavier(".themes"); radioClavier(".seg");
  }
  function radioClavier(sel) {
    var g = document.querySelector(sel); if (!g) return;
    var bs = [].slice.call(g.querySelectorAll('[role="radio"]'));
    bs.forEach(function (b, i) {
      b.tabIndex = b.getAttribute("aria-checked") === "true" ? 0 : -1;
      b.onkeydown = function (e) {
        var d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]; if (!d) return;
        e.preventDefault(); var n = bs[(i + d + bs.length) % bs.length]; n.focus(); n.click();
        bs.forEach(function (x) { x.tabIndex = x === n ? 0 : -1; });
      };
    });
  }

  /* ---- Viseur : cadrage de la facture avant la photo (sinon l'appareil photo du téléphone) ---- */
  var vf = null, flux = null, prises = 0;
  function viseur(o) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return o.secours();
    if (!vf) {
      vf = document.createElement("div"); vf.className = "vf"; vf.setAttribute("role", "dialog"); vf.setAttribute("aria-label", "Cadrer la facture");
      vf.innerHTML = '<video playsinline muted autoplay></video><div class="mask corners"><div class="ticks"></div></div>' +
        '<div class="tip" id="vfTip">Cadrez la facture dans le rectangle<small>Bien à plat, toute la facture visible, sans reflet.</small></div>' +
        '<div class="flash"></div><div class="bar"><button type="button" class="ibtn" id="vfGal" aria-label="Choisir dans la galerie">' + I.img + '</button>' +
        '<button type="button" class="shutter" id="vfShot" aria-label="Prendre la photo"><span>' + I.cam + '</span></button>' +
        '<button type="button" class="ibtn r" id="vfX" aria-label="Fermer le viseur">' + I.x + '</button></div>';
      document.body.appendChild(vf);
    }
    var v = vf.querySelector("video"); prises = 0;
    vf.querySelector("#vfTip").innerHTML = 'Cadrez la facture dans le rectangle<small>Bien à plat, toute la facture visible, sans reflet.</small>';
    vf.classList.add("on"); document.body.style.overflow = "hidden";
    navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } } })
      .then(function (s) { flux = s; v.srcObject = s; return v.play(); })
      .catch(function () { fermer(); o.secours(); });
    vf.querySelector("#vfX").onclick = function () { fermer(); if (o.fin) o.fin(prises); };
    vf.querySelector("#vfGal").onclick = function () { fermer(); o.galerie(); };
    vf.querySelector("#vfShot").onclick = function () {
      if (!v.videoWidth) return;
      var m = vf.querySelector(".mask").getBoundingClientRect(), r = v.getBoundingClientRect();
      var s = Math.max(r.width / v.videoWidth, r.height / v.videoHeight), ox = (r.width - v.videoWidth * s) / 2, oy = (r.height - v.videoHeight * s) / 2;
      var marge = 0.06, x = (m.left - r.left - ox) / s, y = (m.top - r.top - oy) / s, w = m.width / s, h = m.height / s;
      x -= w * marge; y -= h * marge; w *= 1 + 2 * marge; h *= 1 + 2 * marge;
      x = Math.max(0, x); y = Math.max(0, y); w = Math.min(v.videoWidth - x, w); h = Math.min(v.videoHeight - y, h);
      var c = document.createElement("canvas"); c.width = Math.round(w); c.height = Math.round(h);
      c.getContext("2d").drawImage(v, x, y, w, h, 0, 0, c.width, c.height);
      var f = vf.querySelector(".flash"); f.classList.remove("on"); void f.offsetWidth; f.classList.add("on");
      if (navigator.vibrate) try { navigator.vibrate(12); } catch (e) {}
      c.toBlob(function (b) {
        prises++; o.photo(new File([b], "facture-" + Date.now() + ".jpg", { type: "image/jpeg" }));
        vf.querySelector("#vfTip").innerHTML = prises + " facture" + (prises > 1 ? "s" : "") + " en lecture<small>Cadrez la suivante, ou fermez pour vérifier.</small>";
      }, "image/jpeg", 0.9);
    };
  }
  function fermer() {
    if (flux) { flux.getTracks().forEach(function (t) { t.stop(); }); flux = null; }
    if (vf) vf.classList.remove("on"); document.body.style.overflow = "";
  }

  /* ---- Écran de démarrage : seulement à l'ouverture (app installée ou première visite de la session) ---- */
  function demarrer() {
    var s = document.getElementById("splash"); if (!s) return;
    var deja = false; try { deja = sessionStorage.getItem("nk-splash") === "1"; sessionStorage.setItem("nk-splash", "1"); } catch (e) {}
    var app = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    if (deja && !app) { s.remove(); return; }
    setTimeout(function () { s.classList.add("out"); setTimeout(function () { s.remove(); }, 400); }, mouvementReduit() ? 0 : 700);
  }

  appliquer();
  window.NC = { THEMES: THEMES, theme: theme, mode: mode, sombre: sombre, choisirTheme: choisirTheme, choisirMode: choisirMode,
    mouvementReduit: mouvementReduit, vueReglages: vueReglages, lierReglages: lierReglages, viseur: viseur, fermerViseur: fermer,
    demarrer: demarrer, icones: I };
})();
