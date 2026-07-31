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

## 2. Collect review data

Run one property at a time so a temporary source issue stops safely. Booking
usually serves a human-verification page to a headless browser, so use the
supported headed mode and complete any verification yourself:

```bash
npm run refresh:reviews -- --property olympic_paddington --headed --interactive-challenge
```

Other configured property keys are `potts_point`, `central_sydney`, and
`darling_harbour`. The collector creates the local database publication,
deduplicates by review identity, and publishes only a complete verified result.

Each property is read twice, in both directions, before anything is published,
so a property with a few thousand reviews takes several minutes. Progress is
printed as it goes. A run that fails leaves the previous accepted data intact.

## 3. Start the dashboard

```bash
npm run app
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Stop the local app with
`Ctrl+C` in the terminal.

`data/azzurro-reviews.sqlite` in this bundle already holds a complete collection
of all four properties, so the dashboard has data immediately and step 2 is only
needed to refresh it. The version committed to the repository is schema-only; to
start empty, delete the file and run step 2.

Do not add login details, cookies, or credentials to the project.
