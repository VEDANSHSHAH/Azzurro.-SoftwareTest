# Azzurro Review Intelligence dashboard

The frontend is a React 19/vinext dashboard for non-technical hotel operations
staff. It reads the local JSON service in `../scripts/dashboard-server.mjs`;
that service, in turn, reads the accepted publications in the single SQLite
database.

## Run

From the repository root:

```bash
npm ci
npm ci --prefix dashboard
npm run app
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

The data service must be reachable at
[http://127.0.0.1:4318](http://127.0.0.1:4318). Only local HTTP(S) origins are
allowed by its CORS policy.

## Workspaces

- Overview
- Trends
- Properties
- Review insights
- Reviews
- Data quality

The layout uses a persistent sidebar so charts and review tools do not compete
for one screen. Shared cards, charts, states, filters, score badges, and
formatting helpers are reused across workspaces.

## Important data distinctions

- Booking category scores such as Cleanliness 9.4 are source-level property
  aggregates and appear in the Properties workspace.
- Operational topics such as Cleanliness are evidence-based labels derived
  from individual positive/negative review text. They appear in Insights,
  review cards, the full-review drawer, and the always-visible quick topic
  filters.
- If a period contains negative feedback but no configured phrase match, the
  Insights workspace explains that zero-signal state instead of drawing an
  empty zero-width chart. Score-only and unsupported-language feedback can
  remain honestly unclassified.
- Source facts are never overwritten by sentiment or topic labels.

## State and filtering

Global property/date filters control portfolio metrics. The review explorer
has independent property, date, text, sentiment, topic, score, language, guest
type, room type, sort, and pagination controls. All state is encoded in the
URL, so a filtered view can be refreshed or shared.

Topic and property drill-down links seed the review explorer with the visible
reporting context. Reset controls return to a predictable default.

The header's **Reload dashboard** control rereads the latest accepted SQLite
publication. It does not contact Booking or start the collector. From the
repository root, `npm run refresh:reviews -- --property <key>` performs the
accuracy-gated live refetch.

The status badge reports accepted publication coverage, for example **3 of 4
properties verified**. A property labelled **Pending verification** has no
accepted generation yet; neither label means a scraper process is currently
running.

A property published while Booking's advertised total exceeded its retrievable
review list counts as verified and keeps an amber **source gap** disclosure
showing both counts. The gap is Booking's own aggregation shortfall, so the
badge marks the source, not a failed collection.

## Motion and accessibility

- Recharts series animate with short, consistent easing.
- KPI, property, topic, quality, and review cards use subtle staggered entry.
- Drawer and backdrop transitions remain short and functional.
- `prefers-reduced-motion: reduce` disables animation.
- Navigation, filters, dialogs, and review controls have accessible names.
- The review drawer supports Escape, initial close-button focus, and focus
  restoration.
- Desktop layout was checked for horizontal overflow; narrow layouts collapse
  to one column and the quick topic row scrolls horizontally.

## Commands

```bash
npm run dev
npm run build
npm run lint
npm run typecheck
npm test
```

`npm test` builds all five vinext environments and then verifies the rendered
operations shell and reusable workspace source.

## Main folders

```text
app/                 page shell, fonts, design system and responsive CSS
components/charts/   reusable Recharts components
components/ui/       cards, badges and loading/error/empty states
components/views/    six operations workspaces
lib/                 API client, URL defaults, types and formatting
tests/               rendered production checks
worker/              vinext/Cloudflare-compatible entry
```

## Design choices

The visual system follows Azzurro's navy, warm off-white, and pink accent
language while prioritising readability over decoration. Poppins carries
interface text; Fraunces is reserved for a small number of score and editorial
accents. Charts are used only where trend, distribution, or comparison is
clearer than a list.

The frontend contains no Booking credentials, cookies, source review tokens,
or API keys.
