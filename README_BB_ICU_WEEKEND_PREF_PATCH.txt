CALL RULE PATCH - 2026-07-06

This package starts from the uploaded current build and makes only these scheduler-rule changes:

1) BB ICU rule
   - BB can only be assigned ICU on weeks where BB is also assigned Resp.
   - This is treated as the only allowed same-week BB double assignment.
   - BB is not eligible for ICU on non-BB-Resp weeks.

2) Weekend preference rule
   - Strongly prefers the current week's ICU or GIM physician to take the weekend immediately following that service week.
   - If that is not possible, gives a secondary preference to the next week's ICU or GIM physician for the weekend before their service week.

No changes were made to supabase.js or state.js logic.
Inline scripts and scheduler.js pass node --check syntax validation.
