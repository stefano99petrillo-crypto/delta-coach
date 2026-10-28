// Delta Coach · AI: riceve il testo (e le foto) dall'app, chiama Claude con la chiave del progetto
// e restituisce la risposta. Solo per utenti con un account: massimo LIMITE richieste al giorno ciascuno.
import { createClient } from 'npm:@supabase/supabase-js@2';

const LIMITE = 150;
const MODELLI: Record<string, string> = { quick: 'claude-haiku-5-5', default: 'claude-sonnet-5-5' };
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const risposta = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

function chiaveServizio(): string {
  try { const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default; if (k) return k; } catch (_) { /* chiavi legacy */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return risposta({ error: 'invalid_argument' }, 405);
  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return risposta({ error: 'sampling_disabled', message: 'La chiave AI non è ancora configurata sul server.' }, 503);

    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, chiaveServizio(), { auth: { persistSession: false } });
    const { data: u, error: ue } = await admin.auth.getUser(jwt);
    if (ue || !u?.user) return risposta({ error: 'unauthenticated', message: 'Accesso scaduto: rientra nell\'app.' }, 401);

    const { data: n, error: be } = await admin.rpc('ai_bump', { uid: u.user.id, lim: LIMITE });
    if (!be && typeof n === 'number' && n > LIMITE) return risposta({ error: 'daily_limit', message: 'Hai usato tutte le richieste AI di oggi.' }, 429);

    const body = await req.json().catch(() => ({}));
    const prompt = String(body.prompt || '').slice(0, 120000);
    if (!prompt) return risposta({ error: 'invalid_argument' }, 400);
    const immagini = (Array.isArray(body.images) ? body.images : []).slice(0, 4)
      .filter((i: { data?: string }) => i && typeof i.data === 'string' && i.data.length < 7_000_000)
      .map((i: { type?: string; data: string }) => ({ type: 'image', source: { type: 'base64', media_type: /^image\/(jpeg|png|webp|gif)$/.test(i.type || '') ? i.type : 'image/jpeg', data: i.data } }));

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODELLI[body.tier] || MODELLI.default,
        max_tokens: 6000,
        ...(body.json ? { system: 'Rispondi solo con un oggetto JSON valido: niente testo prima o dopo, niente blocchi di codice.' } : {}),
        messages: [{ role: 'user', content: [...immagini, { type: 'text', text: prompt }] }],
      }),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = String(out?.error?.message || '');
      const code = r.status === 429 || r.status === 529 ? 'rate_limited' : /too long|too many tokens|maximum context/i.test(msg) ? 'prompt_too_large' : /image/i.test(msg) ? 'image_rejected' : r.status === 401 || r.status === 403 ? 'sampling_disabled' : 'ai_error';
      return risposta({ error: code, message: msg }, r.status === 429 ? 429 : 502);
    }
    if (out.stop_reason === 'refusal') return risposta({ error: 'refused', message: 'Richiesta non elaborata' }, 422);
    const text = (out.content || []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('');
    return risposta({ text });
  } catch (e) {
    return risposta({ error: 'ai_error', message: String(e) }, 500);
  }
});
