"""Icone dell'app (Δ arancione su fondo scuro) per la schermata Home del telefono."""
import os
from PIL import Image, ImageDraw, ImageFont

WEB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'web')
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

def icon(size, pad=0.0):
    im = Image.new('RGB', (size, size), '#141514'); d = ImageDraw.Draw(im)
    s = size * (1 - 2 * pad); ox = oy = size * pad
    f = ImageFont.truetype(FONT, int(s * 0.62))
    box = d.textbbox((0, 0), 'Δ', font=f); w, h = box[2] - box[0], box[3] - box[1]
    d.text((ox + (s - w) / 2 - box[0], oy + (s - h) / 2 - box[1] - s * 0.02), 'Δ', font=f, fill='#E86A3A')
    return im

icon(192).save(os.path.join(WEB, 'icon-192.png'))
icon(512).save(os.path.join(WEB, 'icon-512.png'))
icon(512, 0.1).save(os.path.join(WEB, 'icon-maskable-512.png'))
icon(180).save(os.path.join(WEB, 'apple-touch-icon.png'))
print('icone ok')
