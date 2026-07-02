DC ECHO FULL FTE PATCH

Upload these files over the same-named GitHub files:
- admin.html
- index.html
- physician.html
- locum.html
- mobile_snapshot.html

Do NOT replace supabase.js.

Change summary:
- Keeps DC at 0.5 FTE for general weekly services, ICU, weekends, and weekday call.
- Treats Echo separately at 1.0 FTE for DC.
- Echo assignment is balanced across CL, DK, and DC using full Echo weight rather than DC's 0.5 general-service weight.
- If needed, an open OP3/OP2/OP1 slot may be used to make the lowest-Echo physician eligible for Echo that week.
- 48-hour physician call rule remains hard.
- Locum rules remain unaffected.
- Supabase/storage/generate button wiring not changed.
