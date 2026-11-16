import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { usePaginatedItems } from "./use-pagination";

describe("usePaginatedItems", () => {
  it("slices the selected page and resets after filters change", () => {
    const items = Array.from({ length: 25 }, (_, index) => index + 1);
    const { result, rerender } = renderHook(
      ({ values, resetKey }) => usePaginatedItems(values, resetKey),
      { initialProps: { values: items, resetKey: "all" } },
    );

    expect(result.current.currentItems).toEqual(items.slice(0, 10));
    act(() => result.current.onPageChange(2));
    expect(result.current.currentItems).toEqual(items.slice(10, 20));

    rerender({ values: items, resetKey: "filtered" });
    expect(result.current.currentPage).toBe(1);
    expect(result.current.currentItems).toEqual(items.slice(0, 10));
  });

  it("clamps to the last available page when items shrink", () => {
    const items = Array.from({ length: 25 }, (_, index) => index + 1);
    const { result, rerender } = renderHook(({ values }) => usePaginatedItems(values), {
      initialProps: { values: items },
    });

    act(() => result.current.onPageChange(3));
    rerender({ values: items.slice(0, 15) });

    expect(result.current.currentPage).toBe(2);
    expect(result.current.currentItems).toEqual(items.slice(10, 15));
  });
});
