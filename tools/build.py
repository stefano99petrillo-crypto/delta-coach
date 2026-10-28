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
app = rep(app, "const APP_URL = 'https://claude.ai/artifact/YStMEt7SUf3To1ExRMN3Zt';", "const APP_URL = /^https:/.test(location.origin) ? location.origin : 'https://delta-coach.vercel.app';")
app = rep(app, "Scegli il tuo ruolo e inserisci il codice che ti ha dato il manager della palestra.", "Scegli il tuo ruolo e inserisci il codice staff che ti ha dato il responsabile di Delta Coach. Dopo la sua approvazione entri.")
# sul web il cloud è la copia principale: il telefono tiene in memoria solo i mesi recenti
app = rep(app, "183 * DAY", "45 * DAY", 3)
app = rep(app, "62 * DAY", "35 * DAY", 3)
# Supabase accetta documenti grandi: il limite di 250 KB serviva solo dentro Claude
app = rep(app, "if (j.length > 250000) { troppoGrande(D.id); continue; }", "if (j.length > 4000000) { troppoGrande(D.id); continue; }")
# testi pensati per l'app dentro Claude: sul web l'AI è inclusa e l'accesso è con email e password
app = rep(app, "x: 'Chiudi e riapri l\\'app dal link. Se non cambia, aprila dal sito claude.ai o dall\\'app Claude aggiornata.' };", "x: 'Chiudi e riapri l\\'app. Se non cambia, riprova tra qualche minuto: nel frattempo puoi inserire i dati a mano.' };")
app = rep(app, "<strong>Come funziona:</strong> l\\'AI dell\\'app usa l\\'account Claude di chi la sta usando, quindi ognuno usa i propri messaggi. La prima volta l\\'app chiede il permesso: tocca <strong>Consenti</strong>, anche per le foto. Senza AI l\\'app funziona lo stesso: i pasti si inseriscono a mano.", "<strong>Come funziona:</strong> l\\'AI è inclusa nell\\'app: ognuno ha fino a 150 richieste al giorno (foto dei pasti, descrizioni, schede, piani). Senza AI l\\'app funziona lo stesso: i dati si inseriscono a mano.")
app = rep(app, "<span class=\"eyebrow\">1 · Dai l\\'accesso</span><span class=\"small\" style=\"line-height:1.5\">Per ora l\\'app è privata. Su claude.ai apri il menu <strong>Condividi</strong> di questa pagina e scegli chi può aprirla. Chi entra con il proprio account Claude ha i dati salvati nel suo account, separati dai tuoi.</span>", "<span class=\"eyebrow\">1 · Come entra</span><span class=\"small\" style=\"line-height:1.5\">Apre il link, crea un account con email e password e inserisce il codice. I suoi dati restano nel suo account, separati dai tuoi.</span>")
app = rep(app, "  if (c === 'rate_limited') return 'Troppe richieste in poco tempo. Riprova tra qualche minuto.';", "  if (c === 'daily_limit') return 'Hai usato tutte le richieste AI di oggi: domani si riparte. Intanto puoi inserire i dati a mano.';\n  if (c === 'rate_limited') return 'Troppe richieste in poco tempo. Riprova tra qualche minuto.';")
# i codici staff veri stanno sul server (tabella dc_codes): nel codice pubblico non restano codici validi
app = rep(app, "const DEFAULT_CFG = { pt: 'PT-7Q4K', gt: 'GT-2M9X', manager: 'MGR-5R8L',", "const DEFAULT_CFG = { pt: '', gt: '', manager: '',")
app = rep(app, "\\n\\n1. Apri questo link: ' + APP_URL + '\\n2. Scegli", "\\n\\n1. Apri ' + APP_URL + ' e crea il tuo account (email e password)\\n2. Scegli")

build = hashlib.sha1(app.encode('utf-8')).hexdigest()[:10]
head_extra = (
    '<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
    '<meta name="theme-color" content="#141514">\n'
    '<meta name="description" content="Delta Coach: allenamento, alimentazione, abitudini e progressi con il tuo personal trainer.">\n'
    '<meta name="apple-mobile-web-app-capable" content="yes">\n'
    '<meta name="mobile-web-app-capable" content="yes">\n'
    '<meta name="apple-mobile-web-app-status-bar-style" content="default">\n'
    '<meta name="apple-mobile-web-app-title" content="Delta Coach">\n'
    '<link rel="manifest" href="manifest.webmanifest">\n'
    '<link rel="icon" href="icon-192.png" type="image/png">\n'
    '<link rel="apple-touch-icon" href="apple-touch-icon.png">\n'
    '<style>:root{box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}html{scroll-padding-top:env(safe-area-inset-top,0px)}</style>\n'
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
