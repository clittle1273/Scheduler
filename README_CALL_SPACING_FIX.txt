CALL SPACING FIX

Upload these files over the same-named files in GitHub:
- admin.html
- index.html
- physician.html
- locum.html
- mobile_snapshot.html
- scheduler.js

Do NOT replace supabase.js or state.js for this change.

Change summary:
- Weekend call is treated as a Sat/Sun call block.
- Weekday night-call generation first avoids any call within 48 hours.
- Monday/Tuesday after a weekend call is avoided.
- Monday/Wednesday style spacing is heavily penalized.
- Rules can relax only if needed to avoid leaving a call date unfilled.
