import { useEffect, useState } from "react";

const ITEMS_PER_PAGE = 10;

export function usePaginatedItems<T>(items: readonly T[], resetKey = "", itemsPerPage = ITEMS_PER_PAGE) {
  const [currentPage, setCurrentPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / itemsPerPage));
  const page = Math.min(currentPage, pageCount);

  useEffect(() => {
    setCurrentPage(1);
  }, [resetKey]);

  useEffect(() => {
    setCurrentPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  return {
    currentItems: items.slice((page - 1) * itemsPerPage, page * itemsPerPage),
    currentPage: page,
    pageCount,
    itemsPerPage,
    totalItems: items.length,
    onPageChange: (nextPage: number) => setCurrentPage(Math.max(1, Math.min(nextPage, pageCount))),
  };
}
