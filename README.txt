Department Scheduling Mini App - Test Build

Open admin.html first.

This build uses Supabase cloud sync for the shared scheduler state. All portals should sync through the scheduler_state table:
- admin.html
- physician.html
- locum.html
- mobile_snapshot.html

Suggested test flow:
1. Open admin.html and choose a date range
2. Generate a schedule
3. Open physician.html and submit a request
4. Open locum.html and add coverage / call availability / initials
5. Return to admin.html and review the changes
6. Regenerate or stable regenerate and inspect results

Files:
- index.html
- admin.html
- physician.html
- locum.html
- mobile_snapshot.html
- scheduler.js
- state.js
- ui.js
- styles.css



CLOUD SYNC SETUP
1. Open supabase.js
2. Paste your Supabase Project URL and anon key into the two placeholders
3. In Supabase, create table scheduler_state with these columns:
   - id (text, primary key, default 'global')
   - state (jsonb)
   - updated_at (timestamptz, default now())
4. Insert one row:
   - id = global
   - state = {}
5. Re-upload the updated files to GitHub Pages

Notes
- This build keeps the existing scheduler logic and changes only storage.
- Pages are self contained, so the HTML files were updated directly.
- The app saves locally first and syncs to Supabase in the background.
- All five HTML portals are configured to hydrate from Supabase on load and poll every 15 seconds.
- Upload only the files inside the Version_1.0_supabase_configured folder. Do not upload the __MACOSX folder.
- Admin auth is not yet turned on in this package.
