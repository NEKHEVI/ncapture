# NCapture : logo derive du harfang NEKHEVI v2 (symbole simplifie A) + mot "NCapture".
# Usage : python logo.py   (sources lues dans ASSETS\LOGO\DECLINAISONS, rien n'y est ecrit)
# Sorties : brand\out\ (SVG maitres, PNG, icones web). Aucun fichier source modifie.
import re, io, os, pathlib
import pymupdf
from PIL import Image
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

ICI = pathlib.Path(__file__).parent
SRC = pathlib.Path(r"C:\DEV\CODEGOD\RAWLF\NEKHEVI\ASSETS\LOGO\DECLINAISONS\svg\propositions-petite-taille")
OUT = ICI / "out"
OUT.mkdir(exist_ok=True)
OR, OR_FONCE, FOND, ENCRE_CLAIRE, ENCRE_SOMBRE = "#DEA543", "#BB8221", "#0B0B0C", "#F5F4F1", "#111113"

def symbole(variante):
    t = (SRC / f"nekhevi-symbole-simplifie-A-{variante}.svg").read_text(encoding="utf-8")
    vb = [float(x) for x in re.search(r'viewBox="([^"]+)"', t).group(1).split()]
    corps = re.sub(r"^.*?<svg[^>]*>", "", t, flags=re.S)
    corps = re.sub(r"</svg>\s*$", "", corps)
    corps = re.sub(r"<title>.*?</title>", "", corps, flags=re.S)
    return vb, corps

def place(vb, corps, cx, cy, largeur):
    x, y, w, h = vb
    s = largeur / w
    tx, ty = cx - (x + w / 2) * s, cy - (y + h / 2) * s
    return f'<g transform="translate({tx:.2f} {ty:.2f}) scale({s:.5f})">{corps}</g>', h * s

def crochets(c, inset, long, ep, taille=1000):
    a, b = inset, taille - inset
    d = (f"M{a} {a+long}V{a}H{a+long} M{b-long} {a}H{b}V{a+long} "
         f"M{b} {b-long}V{b}H{b-long} M{a+long} {b}H{a}V{b-long}")
    return f'<path d="{d}" fill="none" stroke="{c}" stroke-width="{ep}" stroke-linecap="round" stroke-linejoin="round"/>'

def marque(fond_sombre=True, tuile=None, echelle=1.0):
    """Marque carree 1000x1000 : crochets de cadrage or + harfang au centre."""
    vb, corps = symbole("couleur-fond-sombre" if fond_sombre else "couleur-fond-clair")
    g, _ = place(vb, corps, 500, 512, 600)
    c = crochets(OR if fond_sombre else OR_FONCE, 96, 200, 50)
    inner = f'<g transform="translate({500-500*echelle:.1f} {500-500*echelle:.1f}) scale({echelle})">{c}{g}</g>'
    bg = ""
    if tuile == "arrondie":
        bg = f'<rect width="1000" height="1000" rx="224" fill="{FOND}"/>'
    elif tuile == "pleine":
        bg = f'<rect width="1000" height="1000" fill="{FOND}"/>'
    return bg + inner

FONTE = TTFont(ICI / "fonts" / "Geist-SemiBold.ttf")
GS, CMAP, UPM = FONTE.getGlyphSet(), FONTE.getBestCmap(), FONTE["head"].unitsPerEm
CAP = FONTE["OS/2"].sCapHeight or 700

def texte(chaine, x, base, cap_px, suivi=-0.01):
    """Chemins SVG du texte (Geist SemiBold), hauteur de capitale = cap_px. Renvoie (d, largeur)."""
    s = cap_px / CAP
    pos, morceaux = 0.0, []
    for ch in chaine:
        nom = CMAP[ord(ch)]
        pen = SVGPathPen(GS)
        GS[nom].draw(TransformPen(pen, (s, 0, 0, -s, x + pos, base)))
        morceaux.append(pen.getCommands())
        pos += GS[nom].width * s + suivi * UPM * s
    return morceaux, pos - suivi * UPM * s

def horizontal(fond_sombre=True):
    """Marque + mot "NCapture" (N or, Capture encre). Hauteur 1000 unites."""
    m = marque(fond_sombre)
    cap = 430
    base = 500 + cap / 2
    morceaux, larg = texte("NCapture", 1160, base, cap)
    or_ = OR if fond_sombre else OR_FONCE
    encre = "#FFFFFF" if fond_sombre else ENCRE_SOMBRE
    mot = f'<path fill="{or_}" d="{morceaux[0]}"/><path fill="{encre}" d="{"".join(morceaux[1:])}"/>'
    w = 1160 + larg + 40
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.0f} 1000"><title>NCapture</title>{m}{mot}</svg>', w

def svg_carre(contenu, titre="NCapture"):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><title>{titre}</title>{contenu}</svg>'

def png(svg, largeur, hauteur=None, nom=None):
    doc = pymupdf.open(stream=svg.encode("utf-8"), filetype="svg")
    page = doc[0]
    z = largeur / page.rect.width
    pix = page.get_pixmap(matrix=pymupdf.Matrix(z, z), alpha=True)
    im = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGBA")
    if hauteur and im.height != hauteur:
        im = im.resize((largeur, hauteur), Image.LANCZOS)
    if nom:
        im.save(OUT / nom, optimize=True)
    return im

def ecrire(nom, contenu):
    (OUT / nom).write_text(contenu, encoding="utf-8")

if __name__ == "__main__":
    for sombre, suf in ((True, "fond-sombre"), (False, "fond-clair")):
        ecrire(f"ncapture-marque-{suf}.svg", svg_carre(marque(sombre)))
        svg, w = horizontal(sombre)
        ecrire(f"ncapture-horizontal-{suf}.svg", svg)
        png(svg, 1600, nom=f"ncapture-horizontal-{suf}.png")
        png(svg_carre(marque(sombre)), 512, nom=f"ncapture-marque-{suf}-512.png")
    icone = svg_carre(marque(True, "arrondie"))
    ecrire("ncapture-icone.svg", icone)
    ecrire("favicon.svg", icone)
    png(icone, 192, nom="icon-192.png")
    png(icone, 512, nom="icon-512.png")
    png(svg_carre(marque(True, "pleine", 0.74)), 512, nom="icon-maskable-512.png")
    png(svg_carre(marque(True, "pleine", 0.84)), 180, nom="apple-touch-icon.png")
    png(icone, 32, nom="favicon-32.png")
    grand = png(icone, 256)
    grand.save(OUT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    print("ok", sorted(p.name for p in OUT.iterdir()))
