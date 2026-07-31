# Start here

This guide covers the one-time setup, collecting reviews, and opening the
dashboard. Use the commands exactly as written in a terminal opened inside the
project folder.

## 1. Install the project

Install Node.js 22.13 or newer, then run:

```bash
npm ci
npm ci --prefix dashboard
npx playwright install chromium
```

This installs the app, dashboard, and browser used to collect public reviews.

## 2. Collect reviews

The included database starts empty. Run one hotel at a time in headed mode so
you can complete a normal Booking verification screen if it appears:

```bash
npm run refresh:reviews -- --property olympic_paddington --headed --interactive-challenge
```

Use the same command with one of these names for the other hotels:

```text
potts_point
central_sydney
darling_harbour
```

The scraper reads each property twice, avoids duplicates, and only saves a
result after the full collection has been checked. Larger properties can take
several minutes. If a run fails, it does not replace previously accepted data.

## 3. Open the dashboard

After at least one property has been collected, run:

```bash
npm run app
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000) in your browser. Leave the
terminal open while using the dashboard. Press `Ctrl+C` in that terminal to
stop it.

Do not add login details, cookies, or credentials to the project.
