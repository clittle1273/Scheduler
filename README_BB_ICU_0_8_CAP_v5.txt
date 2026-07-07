BB ICU/Resp scheduling adjustment v5

Changes from v4:
- Resp is still scheduled before ICU.
- BB Resp requests and Resp assignment are not overridden by ICU needs.
- BB is no longer placed on Resp just to create ICU opportunities.
- BB can receive ICU only on weeks where BB already has Resp.
- BB ICU assignments stop once BB reaches the calculated 0.8 FTE ICU cap for the schedule range.
- ICU/GIM to weekend preference from prior patch remains.
- No Supabase/state storage logic changed.
