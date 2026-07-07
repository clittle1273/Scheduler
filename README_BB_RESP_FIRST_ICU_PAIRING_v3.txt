BB Resp-first / ICU-pairing patch v3

Changes made from v2:
1. Required service generation order now assigns Resp before ICU.
2. BB's Resp requests/Resp assignment are therefore respected before ICU is considered.
3. BB remains ICU eligible at 0.8 FTE.
4. If BB has Resp in a week, the scheduler strongly prefers pairing BB with ICU that same week.
5. ICU logic no longer auto-fills Resp for BB; Resp must come first.
6. Weekend preference from prior patch is preserved.

No Supabase/state storage logic was changed.
