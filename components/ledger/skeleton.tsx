// RowsSkeleton: the ruled-row placeholder every loading.tsx shows, so a slow navigation draws
// something at once. Bars of a few set widths (ledger.css .lg-skel*), a gentle pulse that is off
// under reduced motion, and one "Loading..." line for screen readers (role="status").
//
//   <RowsSkeleton />                     8 rows
//   <RowsSkeleton rows={6} title />      a title bar above the rows (a page with an h1)
//   <RowsSkeleton columns={5} />         the board: five columns side by side, one column on phones
//   <RowsSkeleton title sub />           a line under the title too (a page whose heading has a sub line)
//   <RowsSkeleton title panels={2} />    paper panels instead of ruled rows (a page made of boxed sections)
//   <RowsSkeleton title panels={2} narrow />  the same, as wide as the narrow pages (the fact sheet)
//   <RowsSkeleton back card />           one tall box with the title inside it (a company page)
//   <RowsSkeleton back title />          a "back to the list" bar above the title (company pages, add company)
//
// The title bar is the height of a real h1 and the sub line the height of a sub line, so a page does
// not jump when its content arrives. Server-renderable, no script.

export function RowsSkeleton({
  rows = 8,
  title = false,
  columns = 1,
  sub = false,
  panels = 0,
  back = false,
  narrow = false,
  card = false,
}: {
  rows?: number;
  title?: boolean;
  columns?: number;
  sub?: boolean;
  panels?: number;
  back?: boolean;
  narrow?: boolean;
  card?: boolean;
}) {
  const count = Math.max(1, Math.floor(rows));
  const cols = Math.max(1, Math.floor(columns));
  const boxes = Math.max(0, Math.floor(panels));
  const column = (key: number) => (
    <div key={key} className="lg-skel-col">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="lg-skel-row" data-w={(i + key) % 4}>
          <span className="lg-skel-bar" />
        </div>
      ))}
    </div>
  );
  return (
    <div className="lg-skel" role="status" data-cols={cols > 1 ? cols : undefined}>
      <span className="lg-sr">Loading...</span>
      {back && <div className="lg-skel-back" aria-hidden="true" />}
      {card && (
        <div className="lg-skel-panel lg-skel-card" aria-hidden="true">
          <div className="lg-skel-title" />
          <span className="lg-skel-bar" />
          <span className="lg-skel-bar" data-short />
          <span className="lg-skel-bar" />
        </div>
      )}
      {title && <div className="lg-skel-title" data-sub={sub || undefined} aria-hidden="true" />}
      {title && sub && <div className="lg-skel-sub" aria-hidden="true" />}
      {card ? null : boxes > 0 ? (
        <div className="lg-skel-panels" data-narrow={narrow || undefined} aria-hidden="true">
          {Array.from({ length: boxes }, (_, k) => (
            <div key={k} className="lg-skel-panel">
              <span className="lg-skel-bar" />
              <span className="lg-skel-bar" data-short />
            </div>
          ))}
        </div>
      ) : (
        <div className="lg-skel-grid" aria-hidden="true">
          {Array.from({ length: cols }, (_, k) => column(k))}
        </div>
      )}
    </div>
  );
}
