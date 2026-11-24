import type { AuditLog, CreditTransaction, GuestAccount, Notification, Payment } from "@/types";
import { USE_DEMO_BACKEND } from "./config";
import { api } from "./http";
import {
  mapPhpAccount,
  mapPhpPayment,
  mapPhpTransaction,
  phpNumber,
  phpRow,
  phpRows,
  phpText,
  type PhpRow,
} from "./php-mappers";

export interface AdminDashboard {
  totalGuests: number;
  activeGuests: number;
  totalUsers: number;
  cashiers: number;
  financeManagers: number;
  admins: number;
  totalTransactions: number;
  services: number;
  activity: { label: string; transactions: number; logins: number }[];
  recentAudit: AuditLog[];
}
export interface CashierDashboard {
  totalRecorded: number;
  recordedByMe: number;
  pendingGuest: number;
  disputed: number;
  awaitingFinance: number;
  approved: number;
  rejected: number;
  pendingPrice: number;
  recent: CreditTransaction[];
}
export interface FinanceDashboard {
  totalOutstanding: number;
  totalPayments: number;
  totalApprovedCredit: number;
  approvedCount: number;
  pendingApprovals: number;
  pendingExceptions: number;
  pendingPriceRequests: number;
  pendingHistorical: number;
  totalHistorical: number;
  historicalTarget: number;
  guestCount: number;
  exceeding: GuestAccount[];
  series: { label: string; credit: number; payments: number }[];
  recentPayments: Payment[];
}
export interface GuestDashboard {
  account: GuestAccount;
  pending: CreditTransaction[];
  activity: { at: string; title: string; amount: number; kind: "transaction" | "payment" }[];
  notifications: Notification[];
}

async function phpDashboard(view?: "cashier" | "finance") {
  const response = await api.get<{ dashboard: Record<string, unknown> }>(
    view ? `/dashboard?view=${view}` : "/dashboard",
  );
  return phpRow(response.dashboard);
}

export const dashboardService = {
  admin: async () => {
    if (USE_DEMO_BACKEND) return api.get<AdminDashboard>("/dashboard/admin");
    const row = await phpDashboard();
    const recentAudit = phpRows(row.recent_activity).map((activity) => ({
      id: phpText(activity.id),
      at: phpText(activity.created_at),
      actor: phpText(activity.actor),
      role: "system" as const,
      category: "auth" as const,
      action: phpText(activity.action),
      details: phpText(activity.entity_type),
    }));
    return {
      totalGuests: phpNumber(row.total_guests),
      activeGuests: phpNumber(row.active_guests),
      totalUsers: phpNumber(row.total_users),
      cashiers: phpNumber(row.cashiers),
      financeManagers: phpNumber(row.finance_managers),
      admins: Math.max(0, phpNumber(row.total_users) - phpNumber(row.total_guests) - phpNumber(row.cashiers) - phpNumber(row.finance_managers)),
      totalTransactions: phpNumber(row.total_transactions),
      services: phpNumber(row.services),
      activity: phpRows(row["activity"]).map((activity) => ({
        label: phpText(activity["label"]),
        transactions: phpNumber(activity.transactions),
        logins: phpNumber(activity["logins"]),
      })),
      recentAudit,
    } satisfies AdminDashboard;
  },
  cashier: async () => {
    if (USE_DEMO_BACKEND) return api.get<CashierDashboard>("/dashboard/cashier");
    const row = await phpDashboard("cashier");
    return {
      totalRecorded: phpNumber(row.total_transactions),
      recordedByMe: phpNumber(row["recorded_by_me"] ?? row.total_transactions),
      pendingGuest: phpNumber(row.pending_guest_confirmations),
      disputed: phpNumber(row.disputed),
      awaitingFinance: phpNumber(row.awaiting_finance),
      approved: phpNumber(row.approved),
      rejected: phpNumber(row.rejected),
      pendingPrice: phpNumber(row.pending_price_approval),
      recent: phpRows(row.recent_transactions).map(mapPhpTransaction),
    } satisfies CashierDashboard;
  },
  finance: async () => {
    if (USE_DEMO_BACKEND) return api.get<FinanceDashboard>("/dashboard/finance");
    const row = await phpDashboard("finance");
    const [priceRequests, historical, reconciliation, payments] = await Promise.all([
      api.get<{ requests: unknown[] }>("/service-price-requests"),
      api.get<{ opening_balances: unknown[] }>("/historical-debts"),
      api.get<PhpRow>("/historical-debts/reconciliation"),
      api.get<{ payments: unknown[] }>("/payments"),
    ]);
    const verifiedPayments = phpRows(payments.payments).filter((payment) => payment.status === "verified");
    return {
      totalOutstanding: phpNumber(row.outstanding_debt),
      totalPayments: phpNumber(row.total_verified_payments),
      totalApprovedCredit: phpNumber(row.total_approved_credits),
      approvedCount: phpNumber(row.approved_transaction_count),
      pendingApprovals: phpNumber(row.pending_approvals),
      pendingExceptions: phpNumber(row.pending_exceptional_approvals),
      pendingPriceRequests: phpRows(priceRequests.requests).filter((request) => request.status === "pending").length,
      pendingHistorical: phpRows(historical.opening_balances).filter((balance) => balance.status === "pending_verification").length,
      totalHistorical: phpNumber(reconciliation.verified_opening_balances_total),
      historicalTarget: phpNumber(reconciliation.expected_total),
      guestCount: phpNumber(row.guest_count),
      exceeding: phpRows(row.guests_over_limit_list).map(mapPhpAccount),
      series: phpRows(row["series"]).map((month) => ({
        label: phpText(month["label"]),
        credit: phpNumber(month["credit"]),
        payments: phpNumber(month["payments"]),
      })),
      recentPayments: verifiedPayments.slice(0, 10).map(mapPhpPayment),
    } satisfies FinanceDashboard;
  },
  guest: async () => {
    if (USE_DEMO_BACKEND) return api.get<GuestDashboard>("/dashboard/guest");
    const row = await phpDashboard();
    const [transactions, notifications] = await Promise.all([
      api.get<{ transactions: unknown[] }>("/transactions"),
      api.get<{ notifications: unknown[] }>("/notifications"),
    ]);
    const recentTransactions = phpRows(row.recent_transactions);
    const mappedTransactions = phpRows(transactions.transactions).map(mapPhpTransaction);
    return {
      account: mapPhpAccount(row),
      pending: mappedTransactions.filter((transaction) => transaction.status === "pending_guest"),
      activity: recentTransactions.map((transaction) => ({
        at: phpText(transaction.created_at),
        title: `Credit transaction #${phpText(transaction.id)}`,
        amount: phpNumber(transaction.total_amount),
        kind: "transaction" as const,
      })),
      notifications: phpRows(notifications.notifications).map((notification) => ({
        id: phpText(notification.id),
        at: phpText(notification.created_at),
        title: phpText(notification.notification_type),
        body: phpText(notification.message),
        read: Boolean(notification.read_at),
      })),
    } satisfies GuestDashboard;
  },
};
