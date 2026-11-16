import type {
  CreditTransaction,
  GuestAccount,
  HistoricalDebt,
  Notification,
  Payment,
  PaymentMethod,
  ReportPeriod,
  ReportResult,
  ReportType,
} from "@/types";
import { USE_DEMO_BACKEND } from "./config";
import { api, ApiError } from "./http";
import {
  mapPhpAccount,
  mapPhpHistorical,
  mapPhpPayment,
  mapPhpTransaction,
  phpNumber,
  phpRow,
  phpRows,
  phpText,
} from "./php-mappers";
import { readSession } from "./session";

export interface PaymentInput {
  guestId: string;
  amount: number;
  method: PaymentMethod;
  reference?: string | undefined;
  bankName?: string | undefined;
  paidAt: string;
  verified: boolean;
  note?: string | undefined;
}

export interface HistoricalInput {
  guestId: string;
  amount: number;
  sourceReference: string;
  evidenceNote?: string | undefined;
  originalDate: string;
}

export interface Reconciliation {
  target: number;
  approved: number;
  pending: number;
  rejected: number;
  imported: number;
  difference: number;
  records: number;
}

export interface Statement {
  account: GuestAccount;
  historical: HistoricalDebt[];
  transactions: CreditTransaction[];
  payments: Payment[];
}

function paymentDate(value: string) {
  return value.slice(0, 10);
}

function mapStatement(value: unknown, paymentRows: unknown[] = []): Statement {
  const row = phpRow(value);
  const account = mapPhpAccount(phpRow(row.account));
  const ledger = phpRows(row.ledger);
  return {
    account,
    historical: ledger.filter((entry) => entry.entry_type === "opening_balance").map((entry, index) => ({
      id: `${phpText(entry.entry_date)}-${index}`,
      guestId: account.id,
      guestName: account.fullName,
      amount: phpNumber(entry.amount),
      sourceReference: phpText(entry.description),
      originalDate: phpText(entry.entry_date).slice(0, 10),
      status: "approved" as const,
      enteredBy: "",
      enteredAt: phpText(entry.entry_date),
    })),
    transactions: phpRows(row.transactions).map(mapPhpTransaction),
    payments: paymentRows.map((payment) => mapPhpPayment(phpRow(payment))),
  };
}

export const paymentsService = {
  list: async (guestId?: string) => {
    if (USE_DEMO_BACKEND) return api.get<Payment[]>("/payments", { guestId });
    const response = await api.get<{ payments: unknown[] }>("/payments");
    return phpRows(response.payments)
      .filter((payment) => !guestId || String(payment.guest_id) === guestId)
      .map(mapPhpPayment);
  },
  get: async (id: string) => {
    if (USE_DEMO_BACKEND) return api.get<Payment>(`/payments/${id}`);
    const payment = (await paymentsService.list()).find((item) => item.id === id);
    if (!payment) throw new ApiError("Payment not found.", 404);
    return payment;
  },
  record: async (input: PaymentInput) => {
    if (USE_DEMO_BACKEND) return api.post<Payment>("/payments", input);
    const response = await api.post<{ id: number }>("/payments", {
      guest_id: Number(input.guestId),
      amount: input.amount.toFixed(2),
      method: input.method,
      ...(input.reference ? { reference_number: input.reference } : {}),
      payment_date: paymentDate(input.paidAt),
    });
    if (input.verified) {
      await api.post(`/payments/${response.id}/verify`, { reason: "Funds received and verified by the Finance Manager." });
    }
    return paymentsService.get(String(response.id));
  },
  verify: async (id: string) => {
    if (USE_DEMO_BACKEND) return api.post<Payment>(`/payments/${id}/verify`);
    await api.post(`/payments/${id}/verify`, { reason: "Funds received and verified by the Finance Manager." });
    return paymentsService.get(id);
  },
  reject: async (id: string, reason: string) => {
    if (USE_DEMO_BACKEND) return api.post<Payment>(`/payments/${id}/reject`, { reason });
    await api.post(`/payments/${id}/reject`, { reason });
    return paymentsService.get(id);
  },
  downloadReceipt: (id: string) => api.download(`/payments/${id}/receipt`),
};

export const historicalService = {
  list: async () => {
    if (USE_DEMO_BACKEND) return api.get<HistoricalDebt[]>("/historical-debts");
    const response = await api.get<{ opening_balances: unknown[] }>("/historical-debts");
    return phpRows(response.opening_balances).map(mapPhpHistorical);
  },
  reconciliation: async () => {
    if (USE_DEMO_BACKEND) return api.get<Reconciliation>("/historical-debts/reconciliation");
    const [targetPayload, records] = await Promise.all([
      api.get<unknown>("/historical-debts/reconciliation"),
      historicalService.list(),
    ]);
    const targetResponse = phpRow(targetPayload);
    const target = phpNumber(targetResponse.expected_total);
    const approved = phpNumber(targetResponse.verified_opening_balances_total);
    return {
      target,
      approved,
      pending: records.filter((record) => record.status === "pending_verification").reduce((sum, record) => sum + record.amount, 0),
      rejected: records.filter((record) => record.status === "rejected").reduce((sum, record) => sum + record.amount, 0),
      imported: approved,
      difference: phpNumber(targetResponse.difference),
      records: records.length,
    };
  },
  create: async (input: HistoricalInput) => {
    if (USE_DEMO_BACKEND) return api.post<HistoricalDebt>("/historical-debts", input);
    const response = await api.post<{ id: number }>("/historical-debts", {
      guest_id: Number(input.guestId),
      amount: input.amount.toFixed(2),
      applicable_from: paymentDate(input.originalDate),
      supporting_reference: [input.sourceReference, input.evidenceNote].filter(Boolean).join(" — "),
    });
    const created = (await historicalService.list()).find((record) => record.id === String(response.id));
    if (!created) throw new ApiError("The opening balance was created but could not be reloaded.", 502);
    return created;
  },
  importRows: async (rows: { username: string; amount: number; sourceReference: string; originalDate?: string }[]) => {
    if (USE_DEMO_BACKEND) return api.post<{ created: number; errors: string[] }>("/historical-debts/import", { rows });
    const records = rows.map((row) => {
      return {
        guest_username: row.username,
        amount: row.amount.toFixed(2),
        applicable_from: row.originalDate ? paymentDate(row.originalDate) : new Date().toISOString().slice(0, 10),
        supporting_reference: row.sourceReference,
      };
    });
    const response = await api.post<{ count: number }>("/historical-debts/import", { records });
    return { created: response.count, errors: [] };
  },
  approve: async (id: string) => {
    if (USE_DEMO_BACKEND) return api.post<HistoricalDebt>(`/historical-debts/${id}/approve`);
    await api.post(`/historical-debts/${id}/verify`, { reason: "Opening balance reconciled against the supporting historical record." });
    const record = (await historicalService.list()).find((item) => item.id === id);
    if (!record) throw new ApiError("Verified opening balance was not returned by the server.", 502);
    return record;
  },
  reject: async (id: string) => {
    if (USE_DEMO_BACKEND) return api.post<HistoricalDebt>(`/historical-debts/${id}/reject`);
    await api.post(`/historical-debts/${id}/reject`, { reason: "Rejected during historical debt review." });
    const record = (await historicalService.list()).find((item) => item.id === id);
    if (!record) throw new ApiError("Rejected opening balance was not returned by the server.", 502);
    return record;
  },
};

export const reportsService = {
  run: async (type: ReportType, period: ReportPeriod): Promise<ReportResult> => {
    if (USE_DEMO_BACKEND) return api.get<ReportResult>("/reports", { type, period });
    if (type === "summary") {
      const [summaryResponse, dashboardResponse] = await Promise.all([
        api.get<Record<string, unknown>>("/reports/financial-summary", { period }),
        api.get<{ dashboard: Record<string, unknown> }>("/dashboard"),
      ]);
      const summary = phpRow(summaryResponse);
      const dashboard = phpRow(dashboardResponse.dashboard);
      const rows = Object.entries(summary)
        .filter(([key, value]) => !["period", "from", "to", "generated_at_utc"].includes(key)
          && value !== null && value !== undefined && Number.isFinite(Number(value)))
        .map(([key, value]) => ({ metric: key.replaceAll("_", " "), value: phpNumber(value) }));
      return {
        title: "Financial Summary",
        period,
        from: phpText(summary.from),
        to: phpText(summary.to),
        columns: [{ key: "metric", label: "Metric" }, { key: "value", label: "Value" }],
        rows,
        totals: [
          { label: "Approved credit", value: phpNumber(summary.approved_credits) },
          { label: "Payments received", value: phpNumber(summary.payments_received) },
          { label: "Total outstanding", value: phpNumber(summary.outstanding_debt) },
        ],
        series: phpRows(dashboard.series).map((month) => ({
          label: phpText(month.label),
          credit: phpNumber(month.credit),
          payments: phpNumber(month.payments),
        })),
      } satisfies ReportResult;
    }
    const path = type === "guest_debt" || type === "outstanding"
      ? "/reports/guest-debts"
      : type === "credit_transactions"
        ? "/reports/transactions"
        : type === "historical"
          ? "/reports/historical-debts"
          : "/reports/payments";
    const [reportResponse, dashboardResponse] = await Promise.all([
      api.get<unknown>(path, { period }),
      api.get<{ dashboard: Record<string, unknown> }>("/dashboard"),
    ]);
    const response = phpRow(reportResponse);
    const dashboard = phpRow(dashboardResponse.dashboard);
    const keys = Array.isArray(response.columns) ? response.columns.map(String) : [];
    const rows: Record<string, string | number>[] = phpRows(response.rows).map((row) =>
      Object.fromEntries(keys.map((key) => {
        const value = row[key];
        return [key, typeof value === "string" || typeof value === "number" ? value : String(value ?? "")];
      })),
    );
    const reportTotals = phpRows(response.totals)
      .filter((total) => type !== "guest_debt" || total.label === "Total outstanding")
      .map((total) => ({ label: phpText(total.label), value: phpNumber(total.value) }));
    return {
      title: phpText(response.title, "Financial Report"),
      period,
      from: phpText(response.from),
      to: phpText(response.to),
      columns: keys.map((key) => ({ key, label: key.replaceAll("_", " ") })),
      rows,
      totals: reportTotals,
      series: phpRows(dashboard.series).map((month) => ({
        label: phpText(month.label),
        credit: phpNumber(month.credit),
        payments: phpNumber(month.payments),
      })),
    };
  },
};

export const guestSelfService = {
  account: async () => {
    if (USE_DEMO_BACKEND) return api.get<GuestAccount>("/me/account");
    return mapPhpAccount(await api.get<Record<string, unknown>>("/credit-account"));
  },
  statement: async () => {
    if (USE_DEMO_BACKEND) return api.get<Statement>("/me/statement");
    const guestId = readSession()?.user.guestId ?? readSession()?.user.id;
    if (!guestId) throw new ApiError("Guest session is missing its account identifier.", 401);
    const [statement, payments] = await Promise.all([
      api.get<Record<string, unknown>>(`/guests/${guestId}/statement`),
      paymentsService.list(),
    ]);
    return mapStatement(statement, payments);
  },
  downloadStatement: async () => {
    if (USE_DEMO_BACKEND) throw new ApiError("Use the demo statement export.", 501);
    const guestId = readSession()?.user.guestId ?? readSession()?.user.id;
    if (!guestId) throw new ApiError("Guest session is missing its account identifier.", 401);
    return api.download(`/guests/${guestId}/statement.pdf`);
  },
  downloadStatementFor: (guestId: string) => api.download(`/guests/${guestId}/statement.pdf`),
  notifications: async () => {
    if (USE_DEMO_BACKEND) return api.get<Notification[]>("/me/notifications");
    const response = await api.get<{ notifications: unknown[] }>("/notifications");
    return phpRows(response.notifications).map((notification) => ({
      id: phpText(notification.id),
      at: phpText(notification.created_at),
      title: phpText(notification.notification_type),
      body: phpText(notification.message),
      read: Boolean(notification.read_at),
    }));
  },
  markNotificationsRead: async () => {
    if (USE_DEMO_BACKEND) return api.post<{ ok: true }>("/me/notifications/read");
    const unread = (await guestSelfService.notifications()).filter((notification) => !notification.read);
    await Promise.all(unread.map((notification) => api.post(`/notifications/${notification.id}/read`)));
    return { ok: true as const };
  },
};
