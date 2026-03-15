Department Scheduling Mini App - Test Build

Open admin.html first.

This build uses shared localStorage so the pages talk to each other:
- admin.html
- physician.html
- locum.html
- mobile_snapshot.html

Suggested test flow:
1. Open admin.html and choose a date range
2. Generate a schedule
3. Open physician.html and submit a request
4. Open locum.html and add coverage / call availability / initials
5. Return to admin.html and review the changes
6. Regenerate or stable regenerate and inspect results

Files:
- index.html
- admin.html
- physician.html
- locum.html
- mobile_snapshot.html
- scheduler.js
- state.js
- ui.js
- styles.css
