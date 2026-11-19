# Assemble des captures en planche JPG. Usage : python planche.py <dossier> <sortie.jpg> <motif> [colonnes] [largeur_vignette]
import sys, pathlib
from PIL import Image, ImageDraw, ImageFont
d, sortie, motif = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
cols = int(sys.argv[4]) if len(sys.argv) > 4 else 7
lw = int(sys.argv[5]) if len(sys.argv) > 5 else 260
fs = sorted(d.glob(motif))
ims = [Image.open(f).convert("RGB") for f in fs]
if not ims:
    sys.exit("aucune image")
h = max(int(i.height * lw / i.width) for i in ims)
try:
    ft = ImageFont.truetype("segoeui.ttf", 15)
except OSError:
    ft = ImageFont.load_default()
rows = (len(ims) + cols - 1) // cols
P = Image.new("RGB", (cols * (lw + 16) + 16, rows * (h + 40) + 16), "#0B0B0C")
dr = ImageDraw.Draw(P)
for k, (f, im) in enumerate(zip(fs, ims)):
    x, y = 16 + (k % cols) * (lw + 16), 16 + (k // cols) * (h + 40)
    t = im.resize((lw, int(im.height * lw / im.width)), Image.LANCZOS)
    P.paste(t, (x, y))
    dr.text((x, y + h + 6), f.stem[-34:], font=ft, fill="#C9CED6")
P.save(sortie, quality=86)
print(sortie, P.size)
