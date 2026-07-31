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

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Stop the local app with
`Ctrl+C` in the terminal.

## 3. Collect review data

No terminal command is required to collect reviews. If the dashboard has no
data yet, it shows a **Collect reviews now** button; once data exists, the
same action is available as **Collect reviews** in the header. Clicking it
opens a real browser window and starts the collector for all four properties.
If Booking shows a human-verification page, complete it in that window and
collection continues automatically. Progress for each property appears live
under the header, and the dashboard reloads on its own once a property
publishes.

Each property is read twice, in both directions, before anything is
published, so a property with a few thousand reviews takes several minutes.
A run that fails leaves the previous accepted data intact.

`data/azzurro-reviews.sqlite` in this bundle already holds a complete
collection of all four properties, so the dashboard has data immediately and
this step is only needed to refresh it. The version committed to the
repository is schema-only; to start empty, delete the file.

### Terminal alternative

The dashboard button runs the same collector as this command, useful for
scripting or a single named property:

```bash
npm run refresh:reviews -- --property olympic_paddington --headed --interactive-challenge
```

Other configured property keys are `potts_point`, `central_sydney`, and
`darling_harbour`.

Do not add login details, cookies, or credentials to the project.
