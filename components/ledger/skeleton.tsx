// RowsSkeleton: the ruled-row placeholder every loading.tsx shows, so a slow navigation draws
// something at once. Bars of a few set widths (ledger.css .lg-skel*), a gentle pulse that is off
// under reduced motion, and one "Loading..." line for screen readers (role="status").
//
//   <RowsSkeleton />                     8 rows
//   <RowsSkeleton rows={6} title />      a title bar above the rows (a page with an h1)
//   <RowsSkeleton columns={5} />         the board: five columns side by side, one column on phones
//
// Server-renderable, no script.

export function RowsSkeleton({ rows = 8, title = false, columns = 1 }: { rows?: number; title?: boolean; columns?: number }) {
  const count = Math.max(1, Math.floor(rows));
  const cols = Math.max(1, Math.floor(columns));
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
      {title && <div className="lg-skel-title" aria-hidden="true" />}
      <div className="lg-skel-grid" aria-hidden="true">
        {Array.from({ length: cols }, (_, k) => column(k))}
      </div>
    </div>
  );
}
