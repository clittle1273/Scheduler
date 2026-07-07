BB Resp/ICU and weekend preference patch

Starting from Scheduler-main-2.zip.

Changes:
1. Resp is scheduled before ICU, so Resp requests and Resp assignment are not overridden by ICU logic.
2. BB remains ICU eligible at 0.8 FTE.
3. BB can only be placed on ICU when BB is already assigned Resp that same week.
4. BB is capped at the rounded 0.8 FTE ICU target for the active schedule range and carry-forward history.
5. The scheduler does not force BB onto Resp just to create ICU opportunities.
6. Weekend assignment strongly prefers the same week ICU/GIM physician for the following weekend. If not possible, it falls back to the next week ICU/GIM physician for the weekend before.

No Supabase or state-storage code intentionally changed.
