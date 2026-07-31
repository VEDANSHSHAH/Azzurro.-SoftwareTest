import {
  AlertCircle,
  CheckCircle2,
  CircleDotDashed,
  Database,
  FileCheck2,
  Fingerprint,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import type { DashboardPayload, QualityProperty } from "../../lib/types";
import {
  isAcceptedPublication,
  SOURCE_GAP_VERIFIED_LABEL,
} from "../../lib/publication-status";
import {
  formatCount,
  formatLocalDate,
} from "../../lib/format";
import { SectionCard } from "../ui/SectionCard";

function QualityIcon({ property }: { property: QualityProperty }) {
  if (property.status === "verified") {
    return <CheckCircle2 aria-hidden="true" size={20} />;
  }
  if (property.status === "source-gap") {
    return <AlertCircle aria-hidden="true" size={20} />;
  }
  if (property.status === "evidence-error") {
    return <AlertCircle aria-hidden="true" size={20} />;
  }
  return <CircleDotDashed aria-hidden="true" size={20} />;
}

export function QualityView({ data }: { data: DashboardPayload }) {
  const verifiedPropertyCount = data.quality.properties.filter(
    (property) => isAcceptedPublication(property.status),
  ).length;
  const totalPropertyCount = data.quality.properties.length;
  const pendingPropertyCount = totalPropertyCount - verifiedPropertyCount;

  return (
    <div className="view-stack">
      <section className={`quality-hero quality-hero--${data.quality.overallStatus}`}>
        <span className="quality-hero__icon">
          <ShieldCheck aria-hidden="true" size={28} />
        </span>
        <div>
          <p className="eyebrow">Collection confidence</p>
          <h2>
            {data.quality.overallStatus === "verified"
              ? "All displayed publications passed the accuracy gates."
              : data.quality.overallStatus === "attention"
                ? "Displayed data is usable, with one disclosed source issue."
                : data.quality.overallStatus === "error"
                  ? "A publication failed an evidence check and needs attention."
                  : `${verifiedPropertyCount} of ${totalPropertyCount} properties have verified publications.`}
          </h2>
          <p>
            The dashboard only reads accepted property generations. Failed,
            partial, challenged, or unreconciled scrape attempts are excluded.
            {data.quality.overallStatus === "collecting"
              ? ` ${pendingPropertyCount} ${pendingPropertyCount === 1 ? "property is" : "properties are"} awaiting a qualifying publication. This is a publication status, not an active-scrape indicator.`
              : ""}
          </p>
        </div>
      </section>

      <section aria-label="Data quality summary" className="quality-kpis">
        <article>
          <Database aria-hidden="true" size={20} />
          <div>
            <small>SQLite integrity</small>
            <strong>{data.quality.databaseIntegrity}</strong>
          </div>
        </article>
        <article>
          <Fingerprint aria-hidden="true" size={20} />
          <div>
            <small>Inventory comparison</small>
            <strong>Two sort directions</strong>
          </div>
        </article>
        <article>
          <FileCheck2 aria-hidden="true" size={20} />
          <div>
            <small>Insight rules</small>
            <strong>{data.quality.classifierVersion}</strong>
          </div>
        </article>
        <article>
          <LockKeyhole aria-hidden="true" size={20} />
          <div>
            <small>Credentials stored</small>
            <strong>None</strong>
          </div>
        </article>
      </section>

      <SectionCard
        description="Counts and evidence are shown per property so an operations user can distinguish verified data from an upstream source discrepancy."
        title="Property publication status"
      >
        <div className="quality-property-list">
          {data.quality.properties.map((property) => (
            <article
              className={`quality-property quality-property--${property.status}`}
              key={property.propertyKey}
            >
              <span className="quality-property__icon">
                <QualityIcon property={property} />
              </span>
              <div className="quality-property__main">
                <div className="quality-property__heading">
                  <div>
                    <strong>{property.propertyName}</strong>
                    <span>{property.note}</span>
                  </div>
                  <span className="property-status">
                    {property.status === "verified"
                      ? "Verified"
                      : property.status === "source-gap"
                        ? SOURCE_GAP_VERIFIED_LABEL
                      : property.status === "evidence-error"
                          ? "Evidence error"
                          : property.status === "collecting"
                            ? "Pending verification"
                            : property.status}
                  </span>
                </div>
                <dl>
                  <div>
                    <dt>Retrievable</dt>
                    <dd>
                      {property.retrievableCount == null
                        ? "—"
                        : formatCount(property.retrievableCount)}
                    </dd>
                  </div>
                  <div>
                    <dt>Advertised</dt>
                    <dd>
                      {property.advertisedCount == null
                        ? "—"
                        : formatCount(property.advertisedCount)}
                    </dd>
                  </div>
                  <div>
                    <dt>Disclosed gap</dt>
                    <dd>{formatCount(property.sourceGap)}</dd>
                  </div>
                  <div>
                    <dt>Inventories</dt>
                    <dd>
                      {property.inventoriesMatch == null
                        ? "Pending"
                        : property.inventoriesMatch
                          ? "Exact match"
                          : "Mismatch"}
                    </dd>
                  </div>
                  <div>
                    <dt>Semantic records</dt>
                    <dd>
                      {property.recordsMatch == null
                        ? "Pending"
                        : property.recordsMatch
                          ? "Exact match"
                          : "Mismatch"}
                    </dd>
                  </div>
                  <div>
                    <dt>Parser</dt>
                    <dd>{property.parserVersion ?? "—"}</dd>
                  </div>
                </dl>
                {property.sourceDiscrepancy ? (
                  <p className="quality-property__exception">
                    Stored exception:{" "}
                    {formatCount(
                      property.sourceDiscrepancy.advertisedBucketReviews,
                    )}{" "}
                    advertised versus{" "}
                    {formatCount(
                      property.sourceDiscrepancy.retrievableBucketReviews,
                    )}{" "}
                    retrievable in Booking’s 5–7 score bucket.
                  </p>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </SectionCard>

      <div className="content-grid content-grid--equal">
        <SectionCard
          description="The checks required before a property generation becomes visible here."
          title="Publication gates"
        >
          <ol className="process-list">
            <li>
              <span>1</span>
              <div>
                <strong>Capture a proven public review request</strong>
                <p>Property identity and query fingerprint must match.</p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>Read the complete inventory twice</strong>
                <p>Oldest-first and newest-first identities must reconcile.</p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>Compare every semantic record</strong>
                <p>Text, score, date, stay metadata, and other fields must agree.</p>
              </div>
            </li>
            <li>
              <span>4</span>
              <div>
                <strong>Attest and publish atomically</strong>
                <p>SQLite checks the evidence before replacing the prior generation.</p>
              </div>
            </li>
          </ol>
        </SectionCard>

        <SectionCard
          description="Plain-language limits that remain true even after a successful publication."
          title="What this dashboard does not claim"
        >
          <div className="limitation-list">
            <article>
              <AlertCircle aria-hidden="true" size={18} />
              <p>
                Booking does not provide an atomic source snapshot; two complete
                inventories reduce detectable inconsistency but cannot freeze
                the upstream site.
              </p>
            </article>
            <article>
              <AlertCircle aria-hidden="true" size={18} />
              <p>
                Topic and sentiment labels are deterministic analysis, not
                facts supplied by Booking. Match evidence and rule version are
                retained.
              </p>
            </article>
            <article>
              <AlertCircle aria-hidden="true" size={18} />
              <p>
                Central Sydney advertises one more review than its structured
                list returns. The app discloses the gap and never invents the
                missing review.
              </p>
            </article>
          </div>
        </SectionCard>
      </div>

      <footer className="quality-footer">
        <RefreshCw aria-hidden="true" size={15} />
        Dashboard response generated{" "}
        {new Date(data.quality.generatedAtUtc).toLocaleString("en-AU", {
          timeZone: "Australia/Sydney",
          dateStyle: "medium",
          timeStyle: "short",
        })}
        . Latest review:{" "}
        {formatLocalDate(data.overview.dataThrough, true)}.
      </footer>
    </div>
  );
}
