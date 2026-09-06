# Dashboard Artifact

`dashboard.html` is a self-contained, read-only preview of the customer
dashboard's Home view (health status, latest readings, report files). It has
no build step and no dependencies.

## Publishing (human step)

This file is not published automatically. A human with claude.ai access must:

1. Open a Claude session with the artifact skill available.
2. Set `BASE_URL` near the top of the `<script>` block in `dashboard.html` to
   the deployed dashboard's URL (e.g. `https://your-app.vercel.app`).
3. Publish `dashboard.html` as an Artifact.
4. Re-publish (same steps) after every future edit to this file — publishing
   is not tied to git and does not happen from a PR merge.

## Notes

- The page calls `GET /api/cloud/status` and `GET /api/files` on the
  configured `BASE_URL`. Both endpoints require a signed-in dashboard session
  cookie in cloud mode, so an anonymous viewer of the artifact will see the
  "not connected" empty state unless the dashboard's `DASHBOARD_AUTH` is off
  or the viewer is otherwise authenticated with that origin.
- Cross-origin requests from the artifact's origin to the Vercel deployment
  will also need CORS response headers from the server for the browser to
  read the response; `server.js` does not currently send any. That is a
  separate change to `server.js` and is out of scope for this migration PR.
- Never put real Supabase keys, device tokens, or session secrets into this
  file — it is a static client-side page.
