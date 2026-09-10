# Local pilot audit - 2026-09-10

This is a source and local regression audit, not public deployment approval.
Two sub-agents independently reviewed the Python pipeline and Web API boundary.
The main agent verified documentation, production build and browser workflows.

## Verified

- Python: 166 unittest cases passed, including five new report-path safety tests.
- Web: local-parser, ui-copy, result-warnings, task-security and python-api passed.
- TypeScript: tsc --noEmit passed.
- Production build: passed with an existing broad file-tracing warning in the
  parse-requirements import chain. The warning remains unresolved.
- Browser: desktop 1280x900 and mobile 390x844 passed upload, review, confirmation,
  requirements editing, refresh recovery, download, cross-session isolation and
  deletion. Browser runtime errors were checked. Tests passed again after restart.
- No paid AI calls were needed for this audit. Previous live timing measurements
  are not a substitute for a new model-quality or load test.

## Fixed during this audit

- CLI report destinations could overwrite input/output DOCX files. Both entry
  points now reject matching resolved paths and existing hard-link aliases before
  writing. Regression tests verify source/output bytes remain unchanged.
- Browser regression depended on an ignored local document. It now uses the
  committed synthetic sample, samples/input.docx.
- Security regression now creates its scratch parent directory on a fresh clone.
- README now documents the actual user workflow and limitations, not old UI.

## Still blocking unrestricted public deployment

- Anonymous session rotation bypasses per-session admission limits. Legacy AI
  endpoints also sit outside the workflow queue. Require upstream access control,
  abuse prevention and provider-wide scheduling before exposing paid AI publicly.
- Actual streamed request size must be enforced by a reverse proxy. Application
  checks alone can occur after request bodies have entered memory.
- Cleanup starts on task subsystem initialization; legacy-only use can retain
  expired files until then. Access expiry is not equivalent to physical deletion.
- Queue and admission state are process-local: no replicas or serverless hosting.

## Other limitations

Word/WPS rendering and complete visual layout acceptance were not performed.
An isolated table-formatting call was observed modifying an adjacent protected
caption; the complete pipeline case was not reproduced because automatic table
protection intervened. Keep this as a follow-up regression target, not a proven
end-to-end failure. Public HTTPS, proxy limits, provider outages, sustained load
and cost ceilings still require deployment-specific acceptance.

User files, provider credentials, generated DOCX/PDF and local screenshot outputs
are not part of this audit document. Optional real-paper suites require separately
downloaded inputs; those papers are not redistributed here.
