# Fabrique une fausse camera (MJPEG) : un recu fictif pose sur une table, pour les captures d'ecran du viseur.
# Usage : python outils/camera-factice.py  -> outils/_camera/recu.mjpeg (ignore par git)
import io, pathlib, random
from PIL import Image, ImageDraw, ImageFilter, ImageFont
ICI = pathlib.Path(__file__).parent / "_camera"
ICI.mkdir(exist_ok=True)
W, H = 1280, 960
def police(t, gras=False):
    for n in (("consolab.ttf" if gras else "consola.ttf"), "cour.ttf"):
        try:
            return ImageFont.truetype(n, t)
        except OSError:
            pass
    return ImageFont.load_default()
fond = Image.new("RGB", (W, H), "#2a241e")
d = ImageDraw.Draw(fond)
random.seed(3)
for y in range(0, H, 6):
    c = 36 + int(10 * random.random())
    d.line([(0, y), (W, y + random.randint(-3, 3))], fill=(c + 8, c, c - 6), width=6)
fond = fond.filter(ImageFilter.GaussianBlur(2))
recu = Image.new("RGB", (430, 760), "#f6f3ea")
r = ImageDraw.Draw(recu)
r.text((215, 50), "PETRO-CANADA", font=police(34, True), fill="#222", anchor="mm")
r.text((215, 92), "2026-11-10   No 483920", font=police(19), fill="#333", anchor="mm")
y = 150
for l in ("Essence ordinaire", "41,2 L x 1,478", "", "------------------------"):
    r.text((30, y), l, font=police(20), fill="#333"); y += 36
for a, b, g in (("SOUS-TOTAL", "60.88 $", 0), ("TPS 5%", "3.04 $", 0), ("TVQ 9,975%", "6.07 $", 0), ("TOTAL", "69.99 $", 1)):
    f = police(26 if g else 21, bool(g))
    r.text((30, y), a, font=f, fill="#222"); r.text((400, y), b, font=f, fill="#222", anchor="ra"); y += 42
r.text((30, 660), "TPS 123456789RT0001", font=police(16), fill="#444")
r.text((30, 686), "TVQ 1234567890TQ0001", font=police(16), fill="#444")
ombre = Image.new("RGBA", (470, 800), (0, 0, 0, 0))
ImageDraw.Draw(ombre).rectangle([20, 20, 450, 780], fill=(0, 0, 0, 120))
ombre = ombre.filter(ImageFilter.GaussianBlur(14)).rotate(-3, expand=True, resample=Image.BICUBIC)
fond.paste(ombre, (W // 2 - ombre.width // 2 + 8, H // 2 - ombre.height // 2 + 12), ombre)
rr = recu.convert("RGBA").rotate(-3, expand=True, resample=Image.BICUBIC)
fond.paste(rr, (W // 2 - rr.width // 2, H // 2 - rr.height // 2), rr)
b = io.BytesIO()
fond.save(b, "JPEG", quality=88)
(ICI / "recu.mjpeg").write_bytes(b.getvalue() * 30)
fond.save(ICI / "recu.jpg", quality=88)
print("ok", ICI / "recu.mjpeg")
