/* Delta Coach sul web: login, database (Supabase) e AI (funzione server).
   Espone la stessa interfaccia che l'app usava dentro Claude (window.claude.use), così app.js resta identico. */
(function () {
  'use strict';
  var SB_URL = 'https://ejmhxqpszkpxfcjrqupx.supabase.co';
  var SB_KEY = 'sb_publishable_SWBYtYwTNJk20WS5VAl56w_RnvWV2Vn';
  var SKEY = 'dc_sb_session';
  var APP_SRC = 'app.js?v=' + (window.DC_BUILD || '1');

  /* ---------------- sessione ---------------- */
  function lsGet(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  var session = lsGet(SKEY);
  function saveSession(s) {
    if (s && s.access_token) { s.expires_at = s.expires_at || Math.floor(Date.now() / 1000) + (+s.expires_in || 3600); }
    session = s && s.access_token ? s : null; lsSet(SKEY, session);
  }
  function err(code, message, status) { var e = new Error(message || code); e.code = code; e.status = status; return e; }
  async function http(path, opt) {
    opt = opt || {}; var h = Object.assign({ apikey: SB_KEY }, opt.headers || {});
    if (opt.body != null && !h['Content-Type']) h['Content-Type'] = 'application/json';
    var r;
    try { r = await fetch(SB_URL + path, { method: opt.method || 'GET', headers: h, body: opt.body == null ? undefined : (typeof opt.body === 'string' ? opt.body : JSON.stringify(opt.body)), signal: opt.signal }); }
    catch (e) { if (e && e.name === 'AbortError') throw err('cancelled'); throw err('unavailable', 'Connessione assente'); }
    var txt = await r.text(); var j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) { j = null; }
    if (!r.ok) { var m = (j && (j.msg || j.message || j.error_description || j.error)) || txt || ('HTTP ' + r.status); var c = r.status === 401 || r.status === 403 ? 'permission_denied' : r.status === 429 ? 'resource_exhausted' : r.status === 413 ? 'invalid_argument' : r.status >= 500 ? 'unavailable' : 'invalid_argument'; var e2 = err(c, m, r.status); e2.body = j; throw e2; }
    return j;
  }
  var refreshing = null;
  async function token() {
    if (!session) throw err('permission_denied', 'Non hai effettuato l\'accesso');
    if (session.expires_at - 60 > Date.now() / 1000) return session.access_token;
    if (!refreshing) refreshing = http('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token } })
      .then(function (s) { saveSession(s); return s; })
      .catch(function (e) { if (e.status === 400 || e.status === 401) { saveSession(null); location.reload(); } throw e; })
      .finally(function () { refreshing = null; });
    var s = await refreshing; return s.access_token;
  }
  async function authed(path, opt) { opt = opt || {}; opt.headers = Object.assign({ Authorization: 'Bearer ' + (await token()) }, opt.headers || {}); return http(path, opt); }
  function uid() { return session && session.user && session.user.id; }
  /* funzioni del server (accessi staff): gli errori arrivano con il messaggio della funzione, es. "codice_non_valido" */
  window.dcRpc = function (fn, args) { return authed('/rest/v1/rpc/' + fn, { method: 'POST', body: args || {} }); };
  function enc(v) { return encodeURIComponent(String(v)); }

  /* ---------------- database: stessa forma del db degli artefatti ---------------- */
  function parse(p) {
    var s = String(p).split('/');
    if (s[0] === 'data' && s[1] === 'users') return s.length === 3 ? { k: 'ucoll', uid: s[2] } : { k: 'udoc', uid: s[2], id: s.slice(3).join('/') };
    return s.length === 1 ? { k: 'scoll', coll: s[0] } : { k: 'sdoc', coll: s[0], id: s.slice(1).join('/') };
  }
  function snap(id, data) { return { id: id, exists: data != null, data: function () { return data == null ? undefined : data; } }; }
  function rowsPath(P, sel) {
    if (P.k === 'udoc') return '/rest/v1/user_docs?user_id=eq.' + enc(P.uid) + '&id=eq.' + enc(P.id) + (sel ? '&select=' + sel : '');
    if (P.k === 'sdoc') return '/rest/v1/shared_docs?coll=eq.' + enc(P.coll) + '&id=eq.' + enc(P.id) + (sel ? '&select=' + sel : '');
    if (P.k === 'ucoll') return '/rest/v1/user_docs?user_id=eq.' + enc(P.uid) + '&select=' + (sel || 'id,data');
    return '/rest/v1/shared_docs?coll=eq.' + enc(P.coll) + '&select=' + (sel || 'id,data');
  }
  async function getDoc(P) { var r = await authed(rowsPath(P, 'data')); return r && r[0] ? r[0].data : null; }
  var seen = {};
  async function putDoc(P, data) {
    if (P.k === 'udoc' && data && data._t) seen[P.id] = data._t;
    var row = P.k === 'udoc' ? { user_id: P.uid, id: P.id, data: data } : { coll: P.coll, id: P.id, data: data };
    await authed('/rest/v1/' + (P.k === 'udoc' ? 'user_docs' : 'shared_docs'), { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: row });
  }
  async function pages(q) {
    var out = [], from = 0, step = 500;
    for (;;) {
      var r = await authed(q, { headers: { Range: from + '-' + (from + step - 1), 'Range-Unit': 'items' } }) || [];
      out = out.concat(r); if (r.length < step) break; from += step;
    }
    return out;
  }
  /* foto dei pasti: all'avvio scarico solo quelle degli ultimi giorni, le altre quando apri quel giorno (sono immagini, pesano) */
  var FOTO_GG = 3;
  window.dcFotoCut = new Date(Date.now() - FOTO_GG * 864e5).toISOString().slice(0, 10);
  window.dcFotoDay = function (ds) { return pages('/rest/v1/user_docs?user_id=eq.' + enc(uid()) + '&select=id,data&id=like.' + enc('foto-' + ds + '*') + '&order=id'); };
  async function listColl(P, where) {
    var out;
    if (P.k === 'ucoll' && !where) {
      var base = rowsPath(P);
      var res = await Promise.all([pages(base + '&id=not.like.' + enc('foto-*') + '&order=id'), pages(base + '&or=' + enc('(id.gte.foto-' + window.dcFotoCut + ',id.like.foto-____-__)') + '&id=like.' + enc('foto-*') + '&order=id'),
        pages('/rest/v1/user_docs?user_id=eq.' + enc(P.uid) + '&select=id&id=like.' + enc('foto-*') + '&order=id')]);
      out = res[0].concat(res[1]); out.forEach(function (x) { if (x.data && x.data._t) seen[x.id] = x.data._t; }); window.dcFotoIds = res[2].map(function (x) { return x.id; });
    } else out = await pages(rowsPath(P) + (where ? '&data=cs.' + enc(JSON.stringify(where)) : '') + '&order=id');
    return { docs: out.map(function (x) { return snap(x.id, x.data); }), empty: !out.length, size: out.length };
  }
  var db = {
    doc: function (path) {
      var P = parse(path);
      return {
        id: P.id,
        get: async function () { return snap(P.id, await getDoc(P)); },
        set: async function (data) { await putDoc(P, data); },
        update: async function (patch) { var cur = await getDoc(P); if (cur == null) throw err('not_found', 'Documento inesistente'); await putDoc(P, Object.assign({}, cur, patch)); },
        delete: async function () { await authed(rowsPath(P), { method: 'DELETE', headers: { Prefer: 'return=minimal' } }); }
      };
    },
    collection: function (path) {
      var P = parse(path);
      var api = function (where) { return { get: function () { return listColl(P, where); }, where: function (f, op, v) { var w = Object.assign({}, where || {}); w[f] = v; return api(w); } }; };
      return api(null);
    }
  };

  /* ---------------- AI ---------------- */
  /* foto del telefono (anche 10 MB): le riduco a max 1600 px in JPEG prima di mandarle all'AI, che accetta fino a 5 MB */
  async function shrink(b) {
    try {
      if (!/^image\/(jpeg|png|webp|heic|heif)/i.test(b.type || '') && !(b instanceof Blob)) return b;
      var bmp = await createImageBitmap(b); var sc = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
      if (sc === 1 && b.size < 0.8e6 && /jpeg|png|webp|gif/i.test(b.type || '')) return b;
      var cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * sc); cv.height = Math.round(bmp.height * sc);
      cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
      var out = await new Promise(function (res) { cv.toBlob(res, 'image/jpeg', 0.8); }); return out || b;
    } catch (e) { return b; }
  }
  function blobB64(b) { return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { var s = String(fr.result); res({ type: (b.type || 'image/jpeg'), data: s.slice(s.indexOf(',') + 1) }); }; fr.onerror = rej; fr.readAsDataURL(b); }); }
  function jsonFrom(t) {
    t = String(t || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(t); } catch (e) {}
    var a = t.search(/[\[{]/); var b = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
    if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) {} }
    throw err('invalid_json', 'Risposta non leggibile');
  }
  async function ai(prompt, opts, wantJson) {
    opts = opts || {}; var imgs = [];
    if (opts.images && opts.images.length) imgs = await Promise.all([].slice.call(opts.images, 0, 4).map(function (x) { return shrink(x).then(blobB64); }));
    var r;
    try { r = await authed('/functions/v1/ai', { method: 'POST', body: { prompt: String(prompt), images: imgs, tier: opts.modelTier || 'default', json: !!wantJson }, signal: opts.signal }); }
    catch (e) { var c = e.body && e.body.error; if (c) throw err(c, e.body.message || c, e.status); if (e.code === 'resource_exhausted') throw err('rate_limited'); throw e; }
    var text = (r && r.text) || '';
    if (typeof opts.onText === 'function') { try { opts.onText({ text: text }); } catch (e) {} }
    return wantJson ? jsonFrom(text) : text;
  }
  /* l'app chiama sia sample(prompt, opts) → {text} (consigli, analisi del sonno) sia sample.json(...) */
  var sample = function (p, o) { return ai(p, o, false).then(function (t) { return { text: t }; }); };
  sample.json = function (p, o) { return ai(p, o, true); };
  sample.text = function (p, o) { return ai(p, o, false); };
  sample.limits = async function () { return { images: { maxCount: 4, maxBytes: 5 * 1024 * 1024, mediaTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] } }; };

  /* ---------------- file da scaricare ---------------- */
  var downloads = {
    save: async function (o) {
      var data = o.data; var blob = data instanceof Blob ? data : new Blob([typeof data === 'string' ? data : JSON.stringify(data)], { type: o.mimeType || (/\.json$/i.test(o.filename || '') ? 'application/json' : 'application/octet-stream') });
      if (typeof data === 'string' && /^data:/.test(data)) blob = await (await fetch(data)).blob();
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = o.filename || 'delta-coach'; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    }
  };

  var user = {
    id: async function () { return uid(); },
    me: async function () { return { id: uid(), name: (session.user.user_metadata && session.user.user_metadata.nome) || session.user.email }; },
    isOwner: async function () { return true; }, canEdit: async function () { return true; }, can: async function () { return true; }
  };
  window.claude = { use: async function (name) { return name === 'db' ? db : name === 'user' ? user : name === 'sample' ? sample : name === 'downloads' ? downloads : null; } };
  window.dcLogout = async function () {
    if (!confirm('Uscire dall\'account? Per rientrare servono email e password.')) return;
    try { await authed('/auth/v1/logout', { method: 'POST' }); } catch (e) {}
    var id = uid(); try { ['dc_private_' + id, 'dc_live_' + id].forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {}
    saveSession(null); location.replace(location.pathname);
  };

  /* ---------------- schermata di accesso ---------------- */
  var root = document.getElementById('app');
  var UI = { mode: 'login', msg: '', err: '', busy: false };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function view() {
    var m = UI.mode, h = '<div class="screen notab" style="justify-content:center;max-width:420px;margin:0 auto;width:100%">'
      + '<div class="row start brand" style="gap:10px;margin-bottom:14px"><span class="brandmark" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24"><path d="M12 3.2 21.6 20.4H2.4Z" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/></svg></span><span class="brandname">Delta Coach</span></div><div class="stack" style="gap:6px;margin-bottom:8px"><h1>' + (m === 'signup' ? 'Crea il tuo account' : m === 'reset' ? 'Recupera la password' : m === 'newpw' ? 'Nuova password' : 'Accedi') + '</h1>'
      + '<p class="muted" style="margin:0;line-height:1.5">' + (m === 'signup' ? 'Allenamento, alimentazione e progressi, salvati nel tuo account.' : m === 'reset' ? 'Ti mando una mail con il link per sceglierne una nuova.' : m === 'newpw' ? 'Scegli la nuova password per il tuo account.' : 'Entra con la tua email e la tua password.') + '</p></div>'
      + '<form id="dcauth" class="card" style="gap:12px" novalidate>';
    if (m !== 'newpw') h += '<div class="field"><label for="dc-e">Email</label><input id="dc-e" name="email" type="email" class="input" autocomplete="email" required value="' + esc(UI.email || '') + '"></div>';
    if (m !== 'reset') h += '<div class="field"><label for="dc-p">Password</label><input id="dc-p" name="pw" type="password" class="input" autocomplete="' + (m === 'login' ? 'current-password' : 'new-password') + '" minlength="8" required>' + (m !== 'login' ? '<span class="tiny muted">Almeno 8 caratteri.</span>' : '') + '</div>';
    if (UI.err) h += '<div class="chip acc" style="white-space:normal;line-height:1.4">' + esc(UI.err) + '</div>';
    if (UI.msg) h += '<div class="chip ok" style="white-space:normal;line-height:1.4">' + esc(UI.msg) + '</div>';
    h += '<button class="btn pri wide" type="submit"' + (UI.busy ? ' disabled' : '') + '>' + (UI.busy ? 'Un attimo…' : m === 'signup' ? 'Crea account' : m === 'reset' ? 'Mandami il link' : m === 'newpw' ? 'Salva la password' : 'Accedi') + '</button></form>';
    if (m === 'login') h += '<div class="stack" style="gap:4px;align-items:center"><button type="button" class="link" data-m="signup">Non hai un account? Crealo</button><button type="button" class="link small" data-m="reset">Password dimenticata</button></div>';
    else if (m !== 'newpw') h += '<button type="button" class="link" style="align-self:center" data-m="login">Hai già un account? Accedi</button>';
    root.innerHTML = h + '</div>';
  }
  function itErr(e) {
    var m = String((e && e.message) || '');
    if (/invalid login|invalid_credentials|invalid credentials/i.test(m)) return 'Email o password non corrette.';
    if (/email not confirmed/i.test(m)) return 'Devi prima confermare l\'email: apri il link che ti ho mandato.';
    if (/already registered|already exists/i.test(m)) return 'Esiste già un account con questa email: accedi.';
    if (/password/i.test(m) && /least|short|weak/i.test(m)) return 'Password troppo corta o debole: usa almeno 8 caratteri.';
    if (/rate limit|too many/i.test(m) || (e && e.status === 429)) return 'Troppi tentativi: riprova tra qualche minuto.';
    if (e && e.code === 'unavailable') return 'Connessione assente: controlla internet e riprova.';
    return 'Qualcosa non ha funzionato: ' + m;
  }
  // dopo l'accesso #app appartiene all'app: questi gestori valgono solo per la schermata di login
  root.addEventListener('click', function (ev) { if (started) return; var b = ev.target.closest('[data-m]'); if (!b) return; UI.mode = b.dataset.m; UI.err = ''; UI.msg = ''; var e = document.getElementById('dc-e'); if (e) UI.email = e.value; view(); });
  root.addEventListener('submit', async function (ev) {
    if (started) return;
    if (ev.target.id !== 'dcauth') return; ev.preventDefault(); if (UI.busy) return;
    var fd = new FormData(ev.target); var email = String(fd.get('email') || '').trim().toLowerCase(); var pw = String(fd.get('pw') || ''); UI.email = email || UI.email; UI.err = ''; UI.msg = '';
    if (UI.mode !== 'newpw' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { UI.err = 'Scrivi un\'email valida.'; return view(); }
    if (UI.mode !== 'reset' && pw.length < (UI.mode === 'login' ? 1 : 8)) { UI.err = UI.mode === 'login' ? 'Scrivi la password.' : 'La password deve avere almeno 8 caratteri.'; return view(); }
    UI.busy = true; view(); var back = location.origin + location.pathname;
    try {
      if (UI.mode === 'login') { saveSession(await http('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: email, password: pw } })); return start(); }
      if (UI.mode === 'signup') {
        var r = await http('/auth/v1/signup?redirect_to=' + enc(back), { method: 'POST', body: { email: email, password: pw } });
        if (r && r.access_token) { saveSession(r); return start(); }
        UI.mode = 'login'; UI.msg = 'Account creato. Ti ho mandato una mail a ' + email + ': apri il link per confermare, poi accedi qui.';
      } else if (UI.mode === 'reset') {
        await http('/auth/v1/recover?redirect_to=' + enc(back), { method: 'POST', body: { email: email } });
        UI.msg = 'Se l\'email è registrata, ti è arrivato il link per cambiare la password.';
      } else if (UI.mode === 'newpw') {
        await authed('/auth/v1/user', { method: 'PUT', body: { password: pw } }); UI.busy = false; return start();
      }
    } catch (e) { UI.err = itErr(e); }
    UI.busy = false; view();
  });

  /* rientro dai link delle email (conferma account, recupero password) */
  function fromHash() {
    var h = location.hash.replace(/^#/, ''); if (!/access_token=|error=/.test(h)) return null;
    var q = {}; h.split('&').forEach(function (kv) { var p = kv.split('='); q[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || '').replace(/\+/g, ' ')); });
    history.replaceState(null, '', location.pathname + location.search); return q;
  }
  var started = false;
  function start() {
    if (started) return; started = true; window.dcEmail = session && session.user && session.user.email;
    root.innerHTML = '<div class="boot">Caricamento…</div>';
    // stato staff (in attesa / attivo / disattivato): se la rete non risponde resta indefinito e l'app non blocca nessuno
    window.dcRpc('dc_me').then(function (m) { window.dcMember = m; }, function () {}).then(loadApp);
  }
  /* stesso account su più dispositivi: se torni sull'app e nel frattempo hai salvato qualcosa dall'altro, ricarico i dati
     (mai durante un allenamento in corso o con un pannello aperto, per non perdere quello che stai scrivendo) */
  var lastCheck = Date.now();
  document.addEventListener('visibilitychange', async function () {
    if (document.visibilityState !== 'visible' || !started || Date.now() - lastCheck < 30000) return; lastCheck = Date.now();
    var id = uid(); if (!id) return;
    try {
      if (localStorage.getItem('dc_live_' + id) || document.querySelector('.sheet')) return;
      var rows = await authed('/rest/v1/user_docs?user_id=eq.' + enc(id) + '&select=id,t:data->_t&id=not.like.' + enc('foto-*'));
      var newer = (rows || []).some(function (r) { return r.id !== '_probe' && +r.t > (+seen[r.id] || 0) + 1000; });
      if (newer && !document.querySelector('.sheet') && !localStorage.getItem('dc_live_' + id)) location.reload();
    } catch (e) {}
  });
  function loadApp() {
    var s = document.createElement('script'); s.src = APP_SRC; s.onerror = function () { root.innerHTML = '<div class="boot">Non riesco a caricare l\'app: controlla la connessione e ricarica.</div>'; }; document.body.appendChild(s);
  }
  (async function boot() {
    var q = fromHash();
    if (q && q.error) { UI.err = /expired|invalid/i.test(q.error_description || q.error) ? 'Il link è scaduto o già usato: chiedine un altro.' : (q.error_description || q.error); }
    if (q && q.access_token) {
      saveSession({ access_token: q.access_token, refresh_token: q.refresh_token, expires_in: +q.expires_in || 3600 });
      try { session.user = await authed('/auth/v1/user'); saveSession(session); } catch (e) { saveSession(null); }
      if (session && q.type === 'recovery') { UI.mode = 'newpw'; return view(); }
    }
    if (session) {
      try { await token(); if (!session.user) { session.user = await authed('/auth/v1/user'); saveSession(session); } return start(); }
      catch (e) { if (e.code === 'unavailable' && session && session.user) return start(); saveSession(null); }
    }
    view();
  })();
})();
