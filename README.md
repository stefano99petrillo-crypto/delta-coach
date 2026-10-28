# Delta Coach

App per personal trainer e clienti: allenamento, alimentazione, abitudini, progressi.

## Come è fatta
- `src/delta-coach.html` — l'app completa (la stessa versione dell'artefatto Claude).
- `tools/build.py` — genera il sito in `web/` (`index.html` + `app.js`) con i ritocchi per il web.
- `web/cloud.js` — login (email e password), database e AI. Fa da ponte: l'app parla con Supabase come parlava con Claude.
- `supabase/` — tabelle con le regole di accesso e la funzione `ai` (chiama Claude con la chiave del progetto, max 150 richieste al giorno per utente).
- `vercel.json` — Vercel pubblica la cartella `web/` così com'è, senza build.

## Aggiornare il sito
1. Sostituisci `src/delta-coach.html` con la nuova versione.
2. `python3 tools/build.py`
3. Commit e push su `main`: Vercel ripubblica da solo.

## Servizi
- Supabase (EU, Irlanda): database `user_docs` (dati privati di ogni utente), `shared_docs` (prenotazioni, codici PT, staff), `ai_usage`.
- La chiave AI (`ANTHROPIC_API_KEY`) sta solo nei segreti delle Edge Functions di Supabase, mai nel codice.
