"""Icone dell'app (triangolo Δ oro su fondo nero) per la schermata Home del telefono."""
import os
from PIL import Image, ImageDraw, ImageFont

WEB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'web')
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

def icon(size, pad=0.0):
    k = 4; S = size * k; im = Image.new('RGB', (S, S), '#0A0A0A'); d = ImageDraw.Draw(im)
    s = S * (1 - 2 * pad); o = S * pad; cx = o + s / 2; w = s * 0.50; h = w * 0.90; top = o + s * 0.27
    pts = [(cx, top), (cx + w / 2, top + h), (cx - w / 2, top + h)]
    d.line(pts + [pts[0], pts[1]], fill='#D4AF37', width=int(s * 0.075), joint='curve')
    r = s * 0.0375
    for x, y in pts: d.ellipse((x - r, y - r, x + r, y + r), fill='#D4AF37')
    return im.resize((size, size), Image.LANCZOS)

icon(192).save(os.path.join(WEB, 'icon-192.png'))
icon(512).save(os.path.join(WEB, 'icon-512.png'))
icon(512, 0.1).save(os.path.join(WEB, 'icon-maskable-512.png'))
icon(180).save(os.path.join(WEB, 'apple-touch-icon.png'))
print('icone ok')
