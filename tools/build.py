"""Costruisce il sito in web/ partendo da src/delta-coach.html (la stessa app dell'artefatto Claude).

    python3 tools/build.py

Genera web/index.html (stile e struttura) e web/app.js (logica dell'app) con i ritocchi per il web.
web/cloud.js (login, database Supabase, AI) è scritto a mano e non viene toccato.
"""
import hashlib, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src', 'delta-coach.html')
WEB = os.path.join(ROOT, 'web')

src = open(SRC, encoding='utf-8').read()
a = src.index('<script>'); b = src.rindex('</script>')
head_body = src[:a].strip()
app = src[a + len('<script>'):b]

def rep(text, old, new, count=1):
    n = text.count(old)
    if n != count:
        sys.exit('build: trovate %d occorrenze (attese %d) di %r' % (n, count, old[:90]))
    return text.replace(old, new)

# --- ritocchi per la versione web ---
app = rep(app, "  if (c === 'sampling_disabled') return { k: 'account', t: 'Il tuo account Claude non può usare l\\'AI nelle app', x: 'Succede con alcuni account di lavoro o quando l\\'accesso a Claude è limitato. Prova ad aprire il link con un altro account Claude, anche gratuito.' };",
             "  if (c === 'sampling_disabled') return { k: 'account', t: 'L\\'AI non è ancora attiva sul server', x: 'Manca la chiave AI del progetto. Nel frattempo puoi inserire i dati a mano.' };")
app = rep(app, "const A = {", "const A = {\n  dclogout(){ if (window.dcLogout) window.dcLogout(); },")
app = re.sub(r"h \+= '<p class=\"tiny muted\" style=\"margin:0;text-align:center\">Delta Coach · versione di prova (\d+)</p>';",
             lambda m: "if (window.dcLogout) h += '<button type=\"button\" class=\"btn wide ghost\" data-a=\"dclogout\">Esci dall\\'account' + (window.dcEmail ? ' · ' + esc(window.dcEmail) : '') + '</button>';\n  h += '<p class=\"tiny muted\" style=\"margin:0;text-align:center\">Delta Coach · versione " + m.group(1) + " · web</p>';", app, count=1)
assert 'dclogout' in app

build = hashlib.sha1(app.encode('utf-8')).hexdigest()[:10]
head_extra = (
    '<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
    '<meta name="theme-color" content="#141514">\n'
    '<meta name="description" content="Delta Coach: allenamento, alimentazione, abitudini e progressi con il tuo personal trainer.">\n'
    '<meta name="apple-mobile-web-app-capable" content="yes">\n'
    '<meta name="mobile-web-app-capable" content="yes">\n'
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">\n'
    '<meta name="apple-mobile-web-app-title" content="Delta Coach">\n'
    '<link rel="manifest" href="manifest.webmanifest">\n'
    '<link rel="icon" href="icon-192.png" type="image/png">\n'
    '<link rel="apple-touch-icon" href="apple-touch-icon.png">\n'
)
title_m = re.match(r'\s*<title>[^<]*</title>', head_body)
title = title_m.group(0).strip() if title_m else '<title>Delta Coach</title>'
rest = head_body[title_m.end():] if title_m else head_body
# separa <link>/<style> (head) dal markup (body)
cut = rest.index('<div id="app"')
head_part, body_part = rest[:cut].strip(), rest[cut:].strip()
html = ('<!doctype html>\n<html lang="it">\n<head>\n' + head_extra + title + '\n' + head_part + '\n</head>\n<body>\n' + body_part
        + '\n<script>window.DC_BUILD=' + json.dumps(build) + ';</script>\n<script src="cloud.js?v=' + build + '"></script>\n</body>\n</html>\n')

os.makedirs(WEB, exist_ok=True)
open(os.path.join(WEB, 'index.html'), 'w', encoding='utf-8').write(html)
open(os.path.join(WEB, 'app.js'), 'w', encoding='utf-8').write(app)
print('ok · build', build, '· index', len(html), 'B · app.js', len(app), 'B')
