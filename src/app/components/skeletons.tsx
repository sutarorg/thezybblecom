/* ------------------------------------------------------------------ */
/* Zybble app — page-accurate loading skeletons.                       */
/*                                                                     */
/* Each skeleton mirrors the exact grid, card, table, and typography    */
/* structure of its page so the swap from skeleton → content causes    */
/* zero layout shift. All shells are aria-hidden and purely visual.    */
/* ------------------------------------------------------------------ */
import { cn } from "../../utils/cn";
import { Card, Skel } from "./ui";

/* Shared helpers --------------------------------------------------- */

/** Toolbar row used by the table pages (search field + filter chips). */
function ToolbarSkeleton({
  chips = 4,
  trailing,
}: {
  chips?: number;
  trailing?: "sort" | "count";
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Skel className="h-8 w-full min-w-[200px] flex-1 rounded sm:max-w-xs" />
      <div className="flex items-center gap-1.5">
        {Array.from({ length: chips }).map((_, i) => (
          <Skel key={i} className="h-7 w-[86px] rounded" />
        ))}
      </div>
      {trailing === "sort" ? (
        <div className="ml-auto flex items-center gap-1">
          <Skel className="h-2.5 w-7 rounded" />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skel key={i} className="h-7 w-[110px] rounded" />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Table header cell with the real label style kept visible. */
function Th({ children, className }: { children?: string; className?: string }) {
  return (
    <th
      scope="col"
      className={cn("py-2 pl-3 pr-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-neutral-300", className)}
    >
      {children}
    </th>
  );
}

/** A skeleton row inside one of the standard tables. */
function Tr({ children }: { children: React.ReactNode }) {
  return (
    <tr className="border-b border-black/[0.04] last:border-0">
      {children}
    </tr>
  );
}

/** Deterministic query-cell widths so rows look like real search text. */
const QUERY_WIDTHS = ["w-64", "w-52", "w-72", "w-44", "w-60", "w-56", "w-48", "w-40"];

function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cn("py-2 pl-3 pr-3", className)}>{children}</td>;
}

/** Standard table footer: row count + pagination. */
function TableFooterSkeleton() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/[0.06] px-3 py-2">
      <Skel className="h-2.5 w-36 rounded" />
      <Skel className="h-6 w-44 rounded" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */
export function OverviewSkeleton() {
  return (
    <div aria-hidden="true">
      {/* KPI row — 5 cards, same responsive grid as the real one */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i} className="p-4">
            <div className="flex items-center justify-between">
              <Skel className="h-2.5 w-24" />
              <Skel className="size-6 rounded-md" />
            </div>
            <Skel className="mt-2 h-[26px] w-16 rounded" />
            <Skel className="mt-1.5 h-2 w-28" />
          </Card>
        ))}
      </div>

      {/* recent searches + usage/activity column */}
      <div className="mt-6 grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between px-4 pb-2 pt-4">
            <Skel className="h-3.5 w-28 rounded" />
            <Skel className="h-2.5 w-14 rounded" />
          </div>
          <div className="px-4 pb-4 pt-1">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-2.5">
                <Skel className="size-6 rounded-md" />
                <div className="flex-1 space-y-1.5">
                  <Skel className="h-2.5 w-56 rounded" />
                  <Skel className="h-2 w-32 rounded" />
                </div>
                <Skel className="h-5 w-20 rounded" />
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-3">
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <Skel className="h-3.5 w-28 rounded" />
              <Skel className="h-2.5 w-9 rounded" />
            </div>
            <Skel className="mt-3 block h-1.5 w-full rounded-full" />
            <div className="mt-2 flex items-center justify-between">
              <Skel className="h-2 w-20 rounded" />
              <Skel className="h-2 w-32 rounded" />
            </div>
            <Skel className="mt-1 h-2 w-40 rounded" />
          </Card>
          <Card>
            <div className="flex items-center justify-between px-4 pb-1 pt-4">
              <Skel className="h-3.5 w-28 rounded" />
            </div>
            <div className="px-4 pb-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="py-2.5">
                  <Skel className="h-2.5 w-full rounded" />
                  <Skel className="mt-1.5 h-2 w-2/3 rounded" />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* lead lists row — 4 mini cards */}
      <div className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <Skel className="h-3.5 w-20 rounded" />
            <Skel className="mt-1 h-2 w-44 rounded" />
          </div>
          <Skel className="h-2.5 w-14 rounded" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="p-4">
              <div className="flex items-center justify-between">
                <Skel className="size-7 rounded-md" />
                <Skel className="size-3 rounded" />
              </div>
              <Skel className="mt-3 h-2.5 w-28 rounded" />
              <Skel className="mt-1.5 h-[18px] w-12 rounded" />
              <Skel className="mt-1 h-2 w-36 rounded" />
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Search history — 6-column table (query, location, results, status,
   when, actions) + toolbar + footer                                  */
/* ------------------------------------------------------------------ */
export function SearchHistorySkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      <ToolbarSkeleton chips={4} />
      <div className="overflow-hidden rounded-lg border border-black/[0.06] bg-white">
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <thead>
              <tr className="border-b border-black/[0.06] bg-neutral-50/50">
                <Th className="max-w-[320px]">Search query</Th>
                <Th>Location</Th>
                <Th>Results</Th>
                <Th>Status</Th>
                <Th>When</Th>
                <Th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: rows }).map((_, i) => (
                <Tr key={i}>
                  <Td className="max-w-[320px]">
                    <Skel className={cn("h-2.5 rounded", QUERY_WIDTHS[i % QUERY_WIDTHS.length])} />
                  </Td>
                  <Td>
                    <Skel className="h-2.5 w-24 rounded" />
                  </Td>
                  <Td>
                    <Skel className="h-2.5 w-10 rounded" />
                  </Td>
                  <Td>
                    <Skel className="h-5 w-[72px] rounded" />
                  </Td>
                  <Td>
                    <Skel className="h-2.5 w-[86px] rounded" />
                  </Td>
                  <Td className="pr-2">
                    <Skel className="size-7 rounded" />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </table>
        </div>
        <TableFooterSkeleton />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Lists — toolbar + 3-column card grid                                */
/* ------------------------------------------------------------------ */
export function ListsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div aria-hidden="true">
      <ToolbarSkeleton chips={0} trailing="sort" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: count }).map((_, i) => (
          <Card key={i} className="p-4">
            {/* header: avatar + name/updated + actions */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <Skel className="size-8 shrink-0 rounded-md" />
                <div className="min-w-0">
                  <Skel className="h-2.5 w-32 rounded" />
                  <Skel className="mt-1 h-2 w-24 rounded" />
                </div>
              </div>
              <Skel className="size-7 rounded" />
            </div>
            {/* description (2 lines) */}
            <Skel className="mt-3 block h-2 w-full rounded" />
            <Skel className="mt-1.5 block h-2 w-2/3 rounded" />
            {/* count + created */}
            <Skel className="mt-3 block h-6 w-14 rounded" />
            <Skel className="mt-2 block h-2 w-32 rounded" />
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Exports — 8-column table (file, source, leads, format, status,
   created, completed, actions) + toolbar + footer                    */
/* ------------------------------------------------------------------ */
export function ExportsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      <ToolbarSkeleton chips={4} />
      <div className="overflow-hidden rounded-lg border border-black/[0.06] bg-white">
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full min-w-[800px] text-left">
            <thead>
              <tr className="border-b border-black/[0.06] bg-neutral-50/50">
                <Th>File</Th>
                <Th>Source</Th>
                <Th>Leads</Th>
                <Th>Format</Th>
                <Th>Status</Th>
                <Th>Created</Th>
                <Th>Completed</Th>
                <Th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: rows }).map((_, i) => (
                <Tr key={i}>
                  <Td>
                    <span className="flex items-center gap-2">
                      <Skel className="size-3.5 rounded-sm" />
                      <Skel className="h-2.5 w-40 rounded" />
                    </span>
                  </Td>
                  <Td>
                    <Skel className="h-2.5 w-28 rounded" />
                  </Td>
                  <Td>
                    <Skel className="h-2.5 w-10 rounded" />
                  </Td>
                  <Td>
                    <Skel className="h-2.5 w-9 rounded" />
                  </Td>
                  <Td>
                    <Skel className="h-5 w-[76px] rounded" />
                  </Td>
                  <Td>
                    <Skel className="h-2.5 w-[86px] rounded" />
                  </Td>
                  <Td>
                    <Skel className="h-2.5 w-[86px] rounded" />
                  </Td>
                  <Td className="pr-2">
                    <Skel className="size-7 rounded" />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </table>
        </div>
        <TableFooterSkeleton />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Team — seat banner + 6-column member table                          */
/* ------------------------------------------------------------------ */
export function TeamSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      {/* seat summary banner */}
      <Card className="mb-3 flex flex-wrap items-center gap-3 px-4 py-3">
        <Skel className="size-8 rounded-md" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <Skel className="h-2.5 w-48 rounded" />
          <Skel className="h-2 w-36 rounded" />
        </div>
        <Skel className="h-7 w-[92px] rounded" />
      </Card>
      {/* member table */}
      <div className="overflow-hidden rounded-lg border border-black/[0.06] bg-white">
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <thead>
              <tr className="border-b border-black/[0.06] bg-neutral-50/50">
                <Th className="max-w-[280px]">Member</Th>
                <Th>Role</Th>
                <Th className="max-w-[200px]">Workspace</Th>
                <Th>Status</Th>
                <Th>Joined</Th>
                <Th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: rows }).map((_, i) => (
                <Tr key={i}>
                  <Td className="max-w-[280px]">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Skel className="size-7 rounded-full" />
                      <span className="min-w-0">
                        <Skel className="block h-2.5 w-28 rounded" />
                        <Skel className="mt-1 block h-2 w-40 rounded" />
                      </span>
                    </span>
                  </Td>
                  <Td>
                    <span className="inline-flex items-center gap-1.5">
                      <Skel className="size-3 rounded-sm" />
                      <Skel className="h-2.5 w-14 rounded" />
                    </span>
                  </Td>
                  <Td>
                    <Skel className="h-2.5 w-32 rounded" />
                  </Td>
                  <Td>
                    <Skel className="h-5 w-[68px] rounded" />
                  </Td>
                  <Td>
                    <Skel className="h-2.5 w-[86px] rounded" />
                  </Td>
                  <Td className="pr-2">
                    <Skel className="size-7 rounded" />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Workspaces — 3-column card grid with usage bars                     */
/* ------------------------------------------------------------------ */
export function WorkspacesSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="p-4">
          {/* header: avatar + name/members */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <Skel className="size-9 shrink-0 rounded-md" />
              <div className="min-w-0">
                <Skel className="h-2.5 w-36 rounded" />
                <Skel className="mt-1 h-2 w-20 rounded" />
              </div>
            </div>
            <Skel className="size-3 rounded" />
          </div>
          {/* lead usage */}
          <div className="mt-4 flex items-center justify-between">
            <Skel className="h-2 w-16 rounded" />
            <Skel className="h-2.5 w-24 rounded" />
          </div>
          <Skel className="mt-1.5 block h-1 w-full rounded-full" />
          {/* footer: created + plan badge */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-1 border-t border-black/[0.05] pt-3">
            <Skel className="h-2 w-28 rounded" />
            <Skel className="h-5 w-16 rounded" />
          </div>
        </Card>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Billing — plan card + seats card (top) and invoice table (bottom).  */
/* The static Plans grid between them renders immediately, so the two  */
/* parts are separate exports wired to their real positions.          */
/* ------------------------------------------------------------------ */
export function BillingSummarySkeleton() {
  return (
    <div className="grid gap-3 lg:grid-cols-3" aria-hidden="true">
      {/* current plan card */}
      <Card className="p-4 lg:col-span-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <Skel className="size-10 rounded-lg" />
            <div>
              <div className="flex items-center gap-2">
                <Skel className="h-4 w-32 rounded" />
                <Skel className="h-5 w-[72px] rounded" />
              </div>
              <Skel className="mt-1.5 h-2 w-40 rounded" />
            </div>
          </div>
          <Skel className="h-7 w-[132px] rounded" />
        </div>
        <div className="mt-4 grid gap-4 border-t border-black/[0.05] pt-4 sm:grid-cols-3">
          <div>
            <Skel className="h-2 w-12 rounded" />
            <Skel className="mt-1.5 h-2.5 w-32 rounded" />
          </div>
          <div className="sm:col-span-2">
            <Skel className="h-2 w-24 rounded" />
            <div className="mt-1.5 flex items-center gap-2">
              <Skel className="h-1.5 flex-1 rounded-full" />
              <Skel className="h-2.5 w-8 rounded" />
            </div>
            <Skel className="mt-1 h-2 w-48 rounded" />
          </div>
        </div>
      </Card>
      {/* seats card */}
      <Card className="p-4">
        <Skel className="h-3.5 w-12 rounded" />
        <div className="mt-3 flex items-baseline gap-1">
          <Skel className="h-8 w-8 rounded" />
          <Skel className="h-4 w-8 rounded" />
        </div>
        <Skel className="mt-1 h-2 w-40 rounded" />
        <Skel className="mt-3 h-7 w-full rounded" />
      </Card>
    </div>
  );
}

export function BillingInvoicesSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="overflow-hidden rounded-lg border border-black/[0.06] bg-white">
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full min-w-[620px] text-left">
            <thead>
              <tr className="border-b border-black/[0.06] bg-neutral-50/50">
                <Th>Invoice</Th>
                <Th>Date</Th>
                <Th>Description</Th>
                <Th>Amount</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 3 }).map((_, i) => (
                <Tr key={i}>
                  <Td>
                    <span className="flex items-center gap-2">
                      <Skel className="size-3.5 rounded-sm" />
                      <Skel className="h-2.5 w-24 rounded" />
                    </span>
                  </Td>
                  <Td>
                    <Skel className="h-2.5 w-[86px] rounded" />
                  </Td>
                  <Td>
                    <Skel className="h-2.5 w-44 rounded" />
                  </Td>
                  <Td>
                    <Skel className="h-2.5 w-12 rounded" />
                  </Td>
                  <Td>
                    <Skel className="h-5 w-[60px] rounded" />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Usage — 4 KPI cards + bar chart + breakdown rows                    */
/* ------------------------------------------------------------------ */
export function UsageSkeleton() {
  return (
    <div aria-hidden="true">
      {/* KPI row */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-4">
            <div className="flex items-center justify-between">
              <Skel className="h-2.5 w-20" />
              <Skel className="size-6 rounded-md" />
            </div>
            <Skel className="mt-2 h-[26px] w-16 rounded" />
            <Skel className="mt-1.5 h-2 w-28" />
          </Card>
        ))}
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        {/* bar chart */}
        <Card className="p-4 lg:col-span-2">
          <div className="flex items-end justify-between gap-2">
            <div>
              <Skel className="h-3.5 w-32 rounded" />
              <Skel className="mt-1 h-2 w-56 rounded" />
            </div>
            <Skel className="h-5 w-24 rounded" />
          </div>
          <div className="mt-4 flex h-32 items-end gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex w-full max-w-[28px] flex-col items-center gap-1">
                <Skel className="w-full rounded-t" style={{ height: `${35 + ((i * 53) % 130)}px` }} />
                <Skel className="h-2 w-4 rounded" />
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3 border-t border-black/[0.05] pt-2.5">
            <Skel className="h-2 w-28 rounded" />
            <Skel className="ml-auto h-2 w-20 rounded" />
          </div>
        </Card>
        {/* breakdown */}
        <Card className="px-4 pt-4">
          <Skel className="h-3.5 w-24 rounded" />
          <div className="pt-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="border-b border-black/[0.04] py-3 last:border-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <Skel className="size-6 rounded-md" />
                    <Skel className="h-2.5 w-32 rounded" />
                  </span>
                  <Skel className="h-2.5 w-20 rounded" />
                </div>
                {i === 0 ? <Skel className="mt-2 block h-1 w-full rounded-full" /> : null}
              </div>
            ))}
          </div>
          <Skel className="mt-2 h-2 w-full rounded" />
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Settings — tab rail + section card                                  */
/* ------------------------------------------------------------------ */
export function SettingsSkeleton() {
  return (
    <div className="grid min-w-0 gap-3 lg:grid-cols-[200px_minmax(0,1fr)]" aria-hidden="true">
      {/* tab rail — same 7 items as the real rail */}
      <nav className="min-w-0 lg:sticky lg:top-[60px] lg:self-start">
        <Card className="p-1.5">
          <ul className="no-scrollbar flex gap-1 overflow-x-auto lg:flex-col lg:overflow-x-visible">
            {Array.from({ length: 7 }).map((_, i) => (
              <li key={i} className="shrink-0 lg:shrink">
                <Skel className={cn("h-8 rounded", i === 0 ? "w-24" : "w-[104px]")} />
              </li>
            ))}
          </ul>
        </Card>
      </nav>
      {/* active section card — profile tab shape */}
      <div className="min-w-0 max-w-[720px]">
        <Card>
          <div className="border-b border-black/[0.05] px-4 py-4 sm:px-5">
            <Skel className="h-3.5 w-20 rounded" />
            <Skel className="mt-1 h-2 w-56 rounded" />
          </div>
          <div className="space-y-4 px-4 py-5 sm:px-5">
            <div className="flex items-center gap-3">
              <Skel className="size-9 rounded-full" />
              <div className="space-y-1.5">
                <Skel className="h-2.5 w-28 rounded" />
                <Skel className="h-2 w-44 rounded" />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i}>
                  <Skel className="mb-1.5 h-2 w-16 rounded" />
                  <Skel className="h-8 w-full rounded" />
                </div>
              ))}
            </div>
            <div className="flex justify-end border-t border-black/[0.05] pt-4">
              <Skel className="h-7 w-24 rounded" />
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
