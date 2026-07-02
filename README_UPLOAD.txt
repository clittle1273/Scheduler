Generate button repair package.

Upload these files over the existing GitHub files:
- admin.html
- index.html
- physician.html
- locum.html
- mobile_snapshot.html
- scheduler.js

Do not replace supabase.js or state.js.

Fixes:
- Runtime error: options is not defined during Generate
- Runtime error in separate scheduler.js from stray top-level state reference
- Keeps call spacing changes
- Does not change Supabase storage files
