DIAGNOSTIC AUDIT PATCH

This build does not change scheduling rules. It only expands validation messages for unfilled required services.

If ICU/GIM/CAR1/CAR2/Resp/Nephro is left unfilled, Final Review will now show a rule audit listing each physician and why they were not used, for example: away/vacation, already assigned, not eligible, requested no ICU/GIM, or eligible and available.

This is intended to debug rule interactions without weakening existing constraints.
