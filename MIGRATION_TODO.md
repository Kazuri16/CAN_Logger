# Render -> Vercel Migration To-Do

Tracking checklist for retiring Render and standardizing on Vercel, plus the
optional claude.ai Artifact preview of the dashboard.

## This PR

- [x] Remove `render.yaml` and Render references (`Publish_Dashboard_Branch.bat`,
      `Publish_To_GitHub.bat`, `README.md`)
- [x] Fix `Start_Cloud_Dashboard.bat` (unrelated to Render specifically, but
      found during this pass): it set `DASHBOARD_AUTH_EMAIL`/`_PASSWORD`,
      which `server.js` no longer reads post-Supabase-auth migration, and
      never set `SESSION_COOKIE_SECRET` -- it crashed on the server's startup
      guard. It now sets `DASHBOARD_AUTH=off` for the local smoke test unless
      `SUPABASE_URL` is already set.
- [x] Finalize `vercel.json` / `api/index.js` (routes all traffic to
      `api/index.js`, bundles `public/**` via `includeFiles` — already correct
      on this base branch, no gaps found)
- [x] Add a "Deploying to Vercel" section to `README.md`
- [x] Draft `artifact/dashboard.html` (static, read-only preview) and
      `artifact/README.md`
- [x] Run independent code review on the full diff before merge (subagent
      review; findings fixed in a follow-up commit on this branch — see PR
      description)

## Still to do (human / follow-up)

- [ ] Push `publish-clean` to origin and rebase this PR onto it, if that
      branch exists and supersedes `main` (see PR description for base notes)
- [ ] Publish `artifact/dashboard.html` via the artifact skill (human,
      interactive session) after setting `BASE_URL`
- [ ] `vercel link` + set env vars (`DASHBOARD_MODE`, `DASHBOARD_AUTH`,
      Supabase URL/keys, session secret, `DEVICE_UPLOAD_TOKEN`)
- [ ] `vercel deploy --prod`; verify `/api/dashboard-status`, login, and the
      cloud-status POST path
- [ ] Repoint cloud uploads / DNS at the Vercel URL
- [ ] Delete the Render service in the Render dashboard
- [ ] Update `CAN_Logger/PROJECT_PLAN.md` and `docs/current_progress_Status.md`
      per repo rules, if/when those files exist in this repo (neither was
      found at the time of this PR)
