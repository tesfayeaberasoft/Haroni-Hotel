import { Button } from "@/components/ui/button";

function visiblePages(currentPage: number, pageCount: number): (number | "ellipsis-left" | "ellipsis-right")[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);

  const first = Math.max(1, currentPage - 1);
  const last = Math.min(pageCount, currentPage + 1);
  const pages: (number | "ellipsis-left" | "ellipsis-right")[] = [];

  if (first > 1) pages.push(1);
  if (first > 2) pages.push("ellipsis-left");
  for (let page = first; page <= last; page += 1) pages.push(page);
  if (last < pageCount - 1) pages.push("ellipsis-right");
  if (last < pageCount) pages.push(pageCount);

  return pages;
}

export function PaginationControls({
  totalItems,
  currentPage,
  pageCount,
  itemsPerPage,
  onPageChange,
}: {
  totalItems: number;
  currentPage: number;
  pageCount: number;
  itemsPerPage: number;
  onPageChange: (page: number) => void;
}) {
  if (totalItems === 0) return null;

  const firstItem = (currentPage - 1) * itemsPerPage + 1;
  const lastItem = Math.min(currentPage * itemsPerPage, totalItems);

  return (
    <nav aria-label="Pagination" className="mt-4 flex flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">
        Showing {firstItem}-{lastItem} of {totalItems} entries
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
        <Button variant="outline" size="sm" onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1}>
          Previous
        </Button>
        <div className="flex items-center gap-1">
          {visiblePages(currentPage, pageCount).map((page) =>
            typeof page === "number" ? (
              <Button
                key={page}
                variant={page === currentPage ? "default" : "outline"}
                size="icon"
                className="h-8 w-8"
                aria-label={`Go to page ${page}`}
                aria-current={page === currentPage ? "page" : undefined}
                onClick={() => onPageChange(page)}
              >
                {page}
              </Button>
            ) : (
              <span key={page} className="px-1 text-muted-foreground" aria-hidden="true">
                …
              </span>
            ),
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => onPageChange(currentPage + 1)} disabled={currentPage === pageCount}>
          Next
        </Button>
      </div>
    </nav>
  );
}
