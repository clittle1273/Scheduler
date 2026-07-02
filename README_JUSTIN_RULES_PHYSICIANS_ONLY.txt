JUSTIN RULES - GENERATE SAFE - PHYSICIANS ONLY

Upload these files over the same-named files in GitHub:
- admin.html
- index.html
- physician.html
- locum.html
- mobile_snapshot.html

Do NOT replace supabase.js, state.js, or any database settings.

Change summary:
- Generate button wiring was not changed.
- Supabase/localStorage/request persistence was not changed.
- Justin's spacing rules apply only to regular physician-generated night/weekend call.
- Locum call dates and locum weekend coverage remain manual/available and are not blocked or penalized by the 48-hour spacing or weekend-adjacent rules.
- Weekend call remains treated as a Sat/Sun block for regular physicians.
- Weekday night-call generation first avoids physician calls within 48 hours, avoids Mon/Tue after that physician's weekend, and avoids Thu/Fri before that physician's weekend.
- Rules relax only if needed to avoid leaving a physician call date unfilled.

Recommended cache-bust URL after upload:
admin.html?v=justin-physicians-only1
