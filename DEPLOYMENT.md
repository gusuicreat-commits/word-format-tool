# Single-host pilot deployment

This release targets one persistent Node process and a persistent local disk.
Do not run replicas, cluster mode, serverless functions or ephemeral containers:
the queue, admission lock and rate limiter are process-local. Task state is saved
on disk; interrupted work becomes retryable after restart, not silently resumed.

## Production setup

1. Install the locked web dependencies and the Python dependencies. Configure
   `PYTHON_CMD` as an absolute executable path. Keep the Python project beside
   `web`, since processing resolves scripts and templates from its parent.
2. Build from `web` with `npm run build`. Run `npm start -- --hostname 127.0.0.1`
   through a supervisor. Windows can use `tools/serve_web.ps1 -NodePath <path>`
   under a background scheduled task; start it hidden. Do not start two copies.
3. Configure a reverse proxy for a user-owned domain with HTTPS. Set
   `PUBLIC_ORIGIN` to that exact HTTPS origin, including any nonstandard port.
   Restrict direct access to the Node port. Ensure secure session cookies are
   configured correctly for the external HTTPS URL before enabling public traffic.
4. At the proxy, cap request bodies at 11 MB, apply IP request/connection limits,
   and set an upload timeout. Application limits alone do not protect against
   large chunked requests, slow uploads or repeated new anonymous sessions.
5. Give the service account access only to its runtime and task directories.
   Do not expose `tmp`, reports, logs, `.env` or project files as static files.
   Disable document-content backups. Monitor disk usage and process health.

## Behavior and limits

- Anonymous browser cookies bind status, downloads and deletion to a session.
  Clearing cookies loses access. Links are not share links.
- At most eight active workflow tasks; workflows execute one at a time.
  Same-session simultaneous submissions reuse the active task. Individual legacy
  processing APIs additionally limit concurrency and requests.
- Input is limited to 10 MB; DOCX expansion is limited to 100 MB and 10,000 ZIP
  entries. These checks are not a malware scanner or a sandbox.
- Task access expires after two hours (refreshed on successful analysis/output).
  A minute-level sweep deletes expired tasks and outputs while the service is
  running, starting when the task subsystem is initialized. After downtime it
  catches up on initialization. Failed tasks expire too.
- User deletion removes the task's source, state, reports and linked output jobs.
  In-progress tasks cannot be deleted until processing finishes. Downloaded copies
  on the user's computer are outside the service's control.
- Parser scratch files are removed in `finally`; parser cache is session-scoped
  and memory-only, capped at 50 entries with a two-hour TTL. Previously created
  development scratch files need a separately reviewed one-time cleanup.
- Only supplied requirements go to the configured AI API, not the uploaded DOCX.
  The provider's own retention terms must be disclosed for the actual provider.
  Do not describe this as entirely offline processing when AI is enabled.
- Word desktop rendering is not run on the server. Outputs still need manual
  page/layout inspection. Complex layouts remain protected instead of auto-fixed.

## Release gate

Known public-exposure blockers from the current audit:

- Anonymous session identifiers are not authenticated accounts. Rotating cookies
  can bypass per-session limits; direct legacy parsing APIs can consume paid AI
  capacity outside the workflow queue. Require upstream access control and abuse
  limits before any external pilot. Provider-wide throttling is not implemented.
- Body size checks use Content-Length or run after body parsing. A proxy must
  enforce actual streamed body limits; do not expose the Node port directly.
- Cleanup starts with the task subsystem. A process serving only legacy format
  APIs may leave expired files on disk until that subsystem initializes. Expired
  downloads are denied, but access expiry alone is not physical deletion.

Run the Python suite, parser/API/security/UI tests and desktop/mobile task tests.
Verify cross-session access denial, deletion, expiry, restart interruption,
queue overload, proxy upload limits, HTTPS cookies and external AI failures.
Use synthetic documents first. Domain/TLS/proxy and live multi-user load tests
are deployment tasks, not completed merely because the local build passes.
