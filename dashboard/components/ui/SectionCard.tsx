import type { ReactNode } from "react";

interface SectionCardProps {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  eyebrow?: string;
}

export function SectionCard({
  title,
  description,
  action,
  children,
  className = "",
  eyebrow,
}: SectionCardProps) {
  return (
    <section className={`section-card ${className}`}>
      <div className="section-card__header">
        <div>
          {eyebrow ? <p className="section-card__eyebrow">{eyebrow}</p> : null}
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {action ? <div className="section-card__action">{action}</div> : null}
      </div>
      <div className="section-card__content">{children}</div>
    </section>
  );
}
