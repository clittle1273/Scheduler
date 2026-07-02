JUSTIN RULES - HARD 48 HOUR PHYSICIAN CALL SPACING

Upload these five files over the same-named GitHub files:
- admin.html
- index.html
- physician.html
- locum.html
- mobile_snapshot.html

Do NOT replace supabase.js.

What changed from the prior Justin package:
- The 48-hour rule is now hard for regular physicians.
- If a regular physician already has call within 2 calendar days, they are excluded from that weekday call assignment.
- Monday/Tuesday after that physician's weekend call are excluded.
- Thursday/Friday before that physician's weekend call are excluded.
- Locum call selections are not affected by these physician-spacing rules.
- Supabase/storage/request saving/generate button wiring were not changed.

Note: because this is now hard, a call date may be left unfilled if no regular physician can satisfy the spacing rule and no locum is assigned.
