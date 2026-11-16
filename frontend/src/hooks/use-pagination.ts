import { useEffect, useState } from "react";

const ITEMS_PER_PAGE = 10;

export function usePaginatedItems<T>(items: readonly T[], resetKey = "") {
  const [currentPage, setCurrentPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE));
  const page = Math.min(currentPage, pageCount);

  useEffect(() => {
    setCurrentPage(1);
  }, [resetKey]);

  useEffect(() => {
    setCurrentPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  return {
    currentItems: items.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE),
    currentPage: page,
    pageCount,
    itemsPerPage: ITEMS_PER_PAGE,
    totalItems: items.length,
    onPageChange: (nextPage: number) => setCurrentPage(Math.max(1, Math.min(nextPage, pageCount))),
  };
}
