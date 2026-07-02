WORKING ROLLBACK PACKAGE

Goal: get back to a stable working scheduler build.

What changed from the uploaded rescue build:
1. Restored browser localStorage as the first storage layer.
2. Still allows Supabase cloud sync through your existing supabase.js.
3. Disabled the one-time fresh reset so opening the app does not wipe draft/published schedules or requests.
4. Kept the GitHub filenames exactly as expected:
   - index.html
   - admin.html
   - physician.html
   - locum.html
   - mobile_snapshot.html

Upload these five HTML files to GitHub Pages, replacing the existing files.
Keep your existing supabase.js as-is.

After uploading:
1. Close old scheduler tabs.
2. Open admin.html with ?v=rollback1
3. Pick start/end dates.
4. Click Generate Fresh.
5. Refresh and confirm the draft remains.

This is intended as a stability rollback, not another new rule-change build.
