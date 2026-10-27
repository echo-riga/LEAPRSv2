# Google storage simulation

Updated October 27, 2026. The local project-owned HTTP provider models the Google Drive, Forms, and OAuth subset used by the storage tests; see `../mocks/google-storage/default.js`.

## Purpose

Exercise actual storage and migration code over HTTP, including external evaluation forms, Editor sharing, response-access verification, ownership transfer, and retry checkpoints.

## Execution

Run `node --use-system-ca --experimental-strip-types --test scripts/google-storage-transfer.test.mjs scripts/google-storage-database.test.mjs` from the repository root. Each suite starts the provider on an ephemeral localhost port, waits for its listening message, points the real clients at it, and stops it afterward. The database suite uses disposable schemas and needs `.env.local` database connectivity. Fixtures and request counters are inspected through local `/__state`; no real Google token or form is used by these suites.

## Assumptions

- October 27, 2026: Forms response access is modeled separately from public file visibility. Owner/Editor access permits responses; Viewer access does not. Verified separately against the three affected live forms before and after granting Editor access.
- October 27, 2026: This simulation does not establish an organization's external-sharing policy or reproduce permission propagation delays. Denied sharing and response verification must remain retryable.

## Observations

<!-- begin:observations -->
- October 27, 2026: The sole Google member served OAuth refresh, Drive metadata/permissions/discovery, and Forms response checks. External forms on archived requests were discovered and deduplicated; denied response access prevented completion, and retry completed after access recovered. No member stayed silent.
<!-- end:observations -->

## What didn't work

- Prior local CLI dataset runs encountered TLS initialization failures (recorded in `ARCHITECTURE.md`); these suites run the same HTTP handler directly rather than claiming a successful Postman CLI simulation run.
