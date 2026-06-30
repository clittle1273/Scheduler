Request persistence fix

This build prevents stale admin/physician/locum/mobile tabs from wiping submitted physician requests.

Upload all HTML files from this folder. Keep your existing supabase.js.

After upload:
1. Close all old scheduler tabs on all computers if possible.
2. Open admin and physician with ?v=70.
3. Submit one test request.
4. Refresh admin several times. The request should remain.

Important: This build merges request lists on every save. This is intentional to prevent request loss.
