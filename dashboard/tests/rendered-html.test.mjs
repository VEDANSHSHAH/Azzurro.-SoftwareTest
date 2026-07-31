import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("production build server-renders the finished operations shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Azzurro Review Intelligence<\/title>/i);
  assert.match(html, /Guest experience, clearly understood/i);
  assert.match(html, /Preparing the verified view/i);
  assert.match(html, /aria-label="Main navigation"/i);
  assert.match(html, /Review insights/i);
  assert.match(html, /Data quality/i);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site/i);
  assert.doesNotMatch(html, /development preview/i);
});

test("finished source contains the six reusable workspaces and no preview shell", async () => {
  const root = new URL("../", import.meta.url);
  const [
    page,
    layout,
    dashboardApp,
    appHeader,
    sidebar,
    globalFilters,
    propertiesView,
    categoryCharts,
    insightsView,
    qualityView,
    publicationStatus,
    globalsCss,
    packageJson,
  ] =
    await Promise.all([
      readFile(new URL("app/page.tsx", root), "utf8"),
      readFile(new URL("app/layout.tsx", root), "utf8"),
      readFile(new URL("components/DashboardApp.tsx", root), "utf8"),
      readFile(new URL("components/AppHeader.tsx", root), "utf8"),
      readFile(new URL("components/Sidebar.tsx", root), "utf8"),
      readFile(new URL("components/GlobalFilters.tsx", root), "utf8"),
      readFile(new URL("components/views/PropertiesView.tsx", root), "utf8"),
      readFile(
        new URL(
          "components/charts/BookingCategoryComparisonCharts.tsx",
          root,
        ),
        "utf8",
      ),
      readFile(new URL("components/views/InsightsView.tsx", root), "utf8"),
      readFile(new URL("components/views/QualityView.tsx", root), "utf8"),
      readFile(new URL("lib/publication-status.ts", root), "utf8"),
      readFile(new URL("app/globals.css", root), "utf8"),
      readFile(new URL("package.json", root), "utf8"),
    ]);

  assert.match(page, /<DashboardApp\s*\/>/);
  assert.match(layout, /Azzurro Review Intelligence/);
  for (const workspace of [
    "OverviewView",
    "TrendsView",
    "PropertiesView",
    "InsightsView",
    "ReviewsView",
    "QualityView",
  ]) {
    assert.match(dashboardApp, new RegExp(workspace));
  }
  for (const label of [
    "Overview",
    "Trends",
    "Properties",
    "Review insights",
    "Reviews",
    "Data quality",
  ]) {
    assert.match(sidebar, new RegExp(label));
  }
  assert.match(propertiesView, /Booking category comparison/);
  assert.match(categoryCharts, /BookingCategoryPortfolioChart/);
  assert.match(categoryCharts, /A missing bar means Booking did not publish/);
  assert.match(categoryCharts, /Exact Booking category scores/);
  assert.match(categoryCharts, /isAnimationActive=\{!reducedMotion\}/);
  assert.match(insightsView, /<EmptyState/);
  assert.match(insightsView, /No negative topic matches in this period/);
  assert.match(insightsView, /unsupported-language feedback remains unclassified/);
  assert.match(insightsView, /All-time topic matches/);
  assert.match(appHeader, /properties verified/);
  assert.match(appHeader, /isAcceptedPublication/);
  assert.match(appHeader, /SOURCE_GAP_VERIFIED_LABEL/);
  assert.match(
    appHeader,
    /this does not mean a scraper is currently running/,
  );
  assert.doesNotMatch(appHeader, /Collection in progress/);
  assert.match(globalFilters, /publicationStatusLabel/);
  assert.match(publicationStatus, /Pending verification/);
  assert.match(propertiesView, /Pending verification/);
  assert.match(propertiesView, /SOURCE_GAP_VERIFIED_LABEL/);
  assert.match(qualityView, /not an active-scrape indicator/);
  assert.match(qualityView, /isAcceptedPublication/);
  assert.match(qualityView, /SOURCE_GAP_VERIFIED_LABEL/);
  assert.match(
    publicationStatus,
    /Verified with 1-review disclosure/,
  );
  assert.match(
    publicationStatus,
    /status === "verified" \|\| status === "source-gap"/,
  );
  assert.match(sidebar, /collapsed: boolean/);
  assert.match(sidebar, /Collapse navigation/);
  assert.match(sidebar, /Expand navigation/);
  assert.match(dashboardApp, /sidebar-is-collapsed/);
  assert.match(globalsCss, /--content-gutter: clamp\(18px, 2vw, 32px\)/);
  assert.match(globalsCss, /\.sidebar\.is-collapsed/);
  assert.match(globalsCss, /\.app-shell\.sidebar-is-collapsed/);
  assert.doesNotMatch(
    [appHeader, globalFilters, propertiesView, qualityView].join("\n"),
    /Source gap disclosed/,
  );
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  const previewFiles = await readdir(new URL("app/_sites-preview", root), {
    recursive: true,
  }).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  assert.deepEqual(previewFiles, []);
});
