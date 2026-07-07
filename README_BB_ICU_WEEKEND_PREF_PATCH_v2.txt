BB ICU + weekend preference patch v2

Changes from current build:
1. BB remains ICU-eligible at 0.8 FTE.
2. If BB is assigned ICU, Resp is paired to BB in the same week when Resp is still open.
3. BB is not excluded from ICU simply because ICU is assigned before Resp.
4. Weekend preference retained: strong preference for same-week ICU/GIM physician to cover following weekend, fallback to next-week ICU/GIM physician for weekend before.

Supabase/state files are included unchanged from the current uploaded build.
