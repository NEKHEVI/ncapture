# Planche d'apercu du logo NCapture (verification visuelle).
import pathlib
from PIL import Image, ImageDraw
O = pathlib.Path(__file__).parent / "out"
W, H = 1700, 1180
im = Image.new("RGB", (W, H), "#0B0B0C")
d = ImageDraw.Draw(im)
d.rectangle([0, 590, W, H], fill="#F5F4F1")
def coller(nom, x, y, w):
    p = Image.open(O / nom).convert("RGBA")
    r = w / p.width
    p = p.resize((w, int(p.height * r)), Image.LANCZOS)
    im.paste(p, (x, y), p)
coller("ncapture-horizontal-fond-sombre.png", 60, 60, 900)
coller("icon-512.png", 1040, 40, 260)
coller("icon-maskable-512.png", 1340, 40, 260)
for i, s in enumerate((16, 32, 48, 96)):
    coller("icon-512.png", 1040 + i * 130, 400, s)
coller("apple-touch-icon.png", 1560, 400, 120)
coller("ncapture-horizontal-fond-clair.png", 60, 650, 900)
coller("ncapture-marque-fond-clair-512.png", 1040, 640, 300)
coller("ncapture-marque-fond-sombre-512.png", 1380, 640, 280)
im.save(O / "apercu-logo.png")
