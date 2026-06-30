EMERGENCY ROW ISOLATION FIX

This build changes Supabase rowId from 'global' to 'global_v2_20260630'.
Old/stale browser tabs still writing to 'global' cannot wipe new requests saved by this build.

Upload all files, including supabase.js. Then close all old scheduler tabs and open with ?v=500.

On first load, if the new row does not exist, supabase.js will seed it from the legacy 'global' row.
