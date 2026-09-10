# Dashboard migration: Render → Vercel + claude.ai Artifact

Tracking checklist. `[x]` done, `[ ]` outstanding. Owner column: **you** = interactive/human,
**routine** = the scheduled cloud agent (`trig_015V5Hc7BXCBFWbWzrehdVsa`, fires 2026-09-06 19:30 IST).

## Pre-req: get current code onto GitHub (blocks the routine)

- [ ] Commit the uncommitted Supabase changes on `publish-clean` — **you**
- [ ] Independent code review of the full diff (project CLAUDE.md rule) — **you**
- [ ] `git push -u origin publish-clean` — **you**

If `publish-clean` is not on origin when the routine runs, it falls back to
`origin/dashboard-cloud` (or `origin/main`) and its PR will need rebasing onto
`publish-clean` afterward.

## Repo prep (the scheduled routine does this and opens ONE PR)

- [ ] Remove `render.yaml` and Render references (`*.bat`, `README.md`, `.env.example`, docs) — **routine**
- [ ] Finalize `vercel.json` / `api/index.js` as the only serverless target — **routine**
- [ ] Add a "Deploying to Vercel" section to `README.md` — **routine**
- [ ] Draft `artifact/dashboard.html` (self-contained static dashboard) + `artifact/README.md` — **routine**
- [ ] Add `MIGRATION_TODO.md` to the repo and run `npm run check` + `npm test` in the PR — **routine**

## Vercel deploy (human only — cloud agent has no Vercel auth)

- [ ] `vercel link` the `CAN_Logger` dashboard to the `AbhishekE` account — **you**
- [ ] Set env vars in the Vercel project: `DASHBOARD_MODE=cloud`, `DASHBOARD_AUTH`,
      Supabase URL + anon key + service-role key, session secret — **you**
- [ ] `vercel deploy --prod` — **you**
- [ ] Verify `GET /api/status`, login flow, and the ESP32 `POST /api/cloud/status` path — **you**
- [ ] Repoint the ESP32 cloud-upload URL / any DNS at the Vercel deployment — **you**
- [ ] Delete the Render service in the Render dashboard — **you**

## Artifact (human only — publishing needs an interactive session)

- [ ] Review the routine's `artifact/dashboard.html` draft — **you**
- [ ] Publish it via the artifact skill; re-publish on every change — **you**

## Docs (same change as the code, per repo rules)

- [ ] Update `CAN_Logger/PROJECT_PLAN.md` and `CAN_Logger/docs/current_progress_Status.md`
      (strike through old text with `~~ ~~`, add the replacement beside it) — **you**
