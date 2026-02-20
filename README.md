# Running1.0

Running1.0 is a static running analytics dashboard that you can host on GitHub Pages.

## What it does

- Pulls your run activities from Strava (using a pasted temporary access token).
- Supports CSV import from your spreadsheet as a fallback.
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

Open `index.html` directly in your browser, or serve with a local static server:

```bash
python -m http.server 8080
```

Then open <http://localhost:8080>.

## Deploy to GitHub Pages

- Push this repository to GitHub.
- In repository settings, enable GitHub Pages from the `main` branch root.
- Your dashboard will be available at `https://<username>.github.io/<repo>/`.

## Strava note

This app is fully client-side and does not store your token. Use short-lived tokens and keep them private.

## Strava 401 troubleshooting

If the app shows a `401 Unauthorized` error:

- Make sure you pasted an **access token** (not the OAuth authorization code).
- Re-authenticate and generate a fresh token (Strava access tokens are short-lived).
- Ensure your Strava app requested activity scopes (`activity:read` or `activity:read_all`).
- You can paste either raw token text or `Bearer <token>`; the app now normalizes both.


