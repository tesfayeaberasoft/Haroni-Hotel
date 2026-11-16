import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./config", () => ({ USE_DEMO_BACKEND: false }));
vi.mock("./http", () => ({ api: { get: vi.fn() } }));

import { api } from "./http";
import { reportsService } from "./finance.service";

describe("live financial summary reports", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("maps PHP summary metrics, date range, and dashboard chart data", async () => {
    vi.mocked(api.get).mockImplementation(async (path) => {
      if (path === "/reports/financial-summary") {
        return {
          approved_credits: "626130.00",
          payments_received: "1704300.00",
          outstanding_debt: "9362000.00",
          pending_approvals: "3",
          from: "2026-11-01",
          to: "2026-11-30",
          period: "monthly",
          generated_at_utc: "2026-11-14T00:00:00Z",
        } as never;
      }
      if (path === "/dashboard") {
        return {
          dashboard: {
            series: [
              { label: "Jun", credit: "120000.00", payments: "620000.00" },
              { label: "Jul", credit: "80000.00", payments: "300000.00" },
            ],
          },
        } as never;
      }
      throw new Error(`Unexpected API path: ${path}`);
    });

    const report = await reportsService.run("summary", "monthly");

    expect(report).toMatchObject({
      from: "2026-11-01",
      to: "2026-11-30",
      totals: [
        { label: "Approved credit", value: 626130 },
        { label: "Payments received", value: 1704300 },
        { label: "Total outstanding", value: 9362000 },
      ],
      series: [
        { label: "Jun", credit: 120000, payments: 620000 },
        { label: "Jul", credit: 80000, payments: 300000 },
      ],
    });
    expect(report.rows).toContainEqual({ metric: "pending approvals", value: 3 });
    expect(report.rows.some((row) => row.metric === "generated at utc")).toBe(false);
  });

  it.each([
    ["credit_transactions", "/reports/transactions", ["Approved", "Pending", "Rejected"]],
    ["payments", "/reports/payments", ["Total received", "Cash", "Bank transfer"]],
    ["guest_debt", "/reports/guest-debts", ["Total outstanding"]],
    ["outstanding", "/reports/guest-debts", ["Total outstanding", "Guests over limit"]],
    ["historical", "/reports/historical-debts", ["Approved opening balances", "Pending verification", "Unreconciled vs target"]],
  ] as const)("maps %s totals and chart data", async (type, reportPath, labels) => {
    vi.mocked(api.get).mockImplementation(async (path) => {
      if (path === reportPath) {
        return {
          title: "Financial Report",
          from: "2026-11-01",
          to: "2026-11-30",
          columns: ["amount"],
          rows: [{ amount: "12.50" }],
          totals: [
            { label: "Total outstanding", value: "500.00" },
            { label: "Guests over limit", value: "2" },
            { label: "Approved", value: "120.00" },
            { label: "Pending", value: "30.00" },
            { label: "Rejected", value: "5.00" },
            { label: "Total received", value: "200.00" },
            { label: "Cash", value: "75.00" },
            { label: "Bank transfer", value: "125.00" },
            { label: "Approved opening balances", value: "1000.00" },
            { label: "Pending verification", value: "200.00" },
            { label: "Unreconciled vs target", value: "50.00" },
          ].filter((total) => labels.includes(total.label as (typeof labels)[number])
            || (type === "guest_debt" && total.label === "Guests over limit")),
        } as never;
      }
      if (path === "/dashboard") {
        return {
          dashboard: { series: [{ label: "Nov", credit: "120.00", payments: "80.00" }] },
        } as never;
      }
      throw new Error(`Unexpected API path: ${path}`);
    });

    const report = await reportsService.run(type, "monthly");

    expect(report.totals.map((total) => total.label)).toEqual(labels);
    expect(report.series).toEqual([{ label: "Nov", credit: 120, payments: 80 }]);
    expect(report).toMatchObject({ from: "2026-11-01", to: "2026-11-30" });
  });
});
