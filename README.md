# Running1.0

Running1.0 is a static running analytics dashboard that you can host on GitHub Pages.

## What it does

- Pulls your run activities from Strava (using a pasted access token or OAuth authorization code).
- Supports CSV import from your spreadsheet as a fallback.
- Supports loading runs directly from a Google Sheet URL.
- Calculates:
  - monthly mileage
  - monthly remaining mileage (for two adjustable daily pace targets)
  - annual mileage and annual remaining mileage
  - month-over-month comparison
  - pace analysis by month, by run, and overall year
  - 7-day rolling mileage
  - over/under pace against two configurable paces (defaults: 1.9 and 2.3 mi/day)
  - distance histogram for the year
  - percentage of year goal completed
  - time predictor for an entered run distance using recent run pace
  - weekly breakdown of miles remaining to stay on target

## Run locally

Run the local server so the OAuth code exchange endpoint is available:

```bash
npm start
```

Then open <http://localhost:8080>.

### Strava backend environment variables

Set these before starting the server:

```bash
export STRAVA_CLIENT_ID=your_client_id
export STRAVA_CLIENT_SECRET=your_client_secret
# Optional: include if your Strava app requires redirect URI matching during token exchange
export STRAVA_REDIRECT_URI=http://localhost:8080
```

Then run:

```bash
npm start
```

## Deploy to GitHub Pages

- Push this repository to GitHub.
- In repository settings, enable GitHub Pages from the `main` branch root.
- Your dashboard will be available at `https://<username>.github.io/<repo>/`.
- GitHub Pages does not run the local backend endpoint, so Strava authorization-code exchange will not work there
  unless you host `/api/strava/exchange` separately.

## Strava note

The Strava code exchange is handled by a local backend endpoint (`POST /api/strava/exchange`) so your client secret
stays server-side. Access tokens are still short-lived.

## Strava 401 troubleshooting

If Strava loading fails:

- If using an authorization code, confirm the local backend is running and has `STRAVA_CLIENT_ID` and
  `STRAVA_CLIENT_SECRET`.
- For `401 Unauthorized`, re-authenticate and use a fresh token/code.
- Ensure your Strava app requested activity scopes (`activity:read` or `activity:read_all`).
- You can paste raw token text, `Bearer <token>`, callback URL, JSON token payload, or `code`.



## GitHub PR conflict fix (`This branch has conflicts that must be resolved`)

If GitHub shows this, it means your PR branch is behind the base branch and must be updated.

```bash
git checkout work
git fetch origin
git rebase origin/main
# resolve conflicts in files Git reports
# then for each resolved file:
git add <file>
git rebase --continue
# when rebase completes
git push --force-with-lease origin work
```

If you prefer merge instead of rebase:

```bash
git checkout work
git fetch origin
git merge origin/main
# resolve conflicts, then:
git add <file>
git commit
git push origin work
```

Tip: if your PR is based on the wrong target branch, change the PR base branch in GitHub first.
