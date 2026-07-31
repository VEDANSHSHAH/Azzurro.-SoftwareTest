# How to run the application

## 1. Install requirements

Install Node.js 22.13 or newer, then open a terminal in the project folder.

```bash
npm ci
npm ci --prefix dashboard
```

Install the browser used by the optional review collector:

```bash
npx playwright install chromium
```

## 2. Start the dashboard

```bash
npm run app
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

The included SQLite file already contains the accepted sample review data, so
the dashboard opens without running a collection first. Stop the local app
with `Ctrl+C` in the terminal.

## 3. Refresh a property later (optional)

Run one property at a time so a temporary source issue stops safely:

```bash
npm run refresh:reviews -- --property olympic_paddington
```

Other configured property keys are `potts_point`, `central_sydney`, and
`darling_harbour`. The collector deduplicates by review identity and publishes
only a complete, verified collection.

If the source presents a normal human-verification page, use the supported
headed mode and complete that verification manually:

```bash
npm run refresh:reviews -- --property central_sydney --headed --interactive-challenge
```

Do not add login details, cookies, or credentials to the project.
