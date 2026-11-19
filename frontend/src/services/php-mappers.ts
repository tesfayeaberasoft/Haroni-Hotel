import type {
  AccountStatus,
  CreditTransaction,
  Guest,
  GuestAccount,
  HistoricalDebt,
  HotelService,
  Payment,
  PriceRequest,
  ServiceCategory,
  StaffUser,
  TransactionStatus,
  TransactionItem,
} from "@/types";

export interface PhpRow extends Record<string, unknown> {
  account?: unknown;
  action?: unknown;
  active_guests?: unknown;
  catalog_price?: unknown;
  actor?: unknown;
  amount?: unknown;
  applicable_from?: unknown;
  approved?: unknown;
  approved_at?: unknown;
  approved_by?: unknown;
  approved_credit?: unknown;
  approved_transaction_count?: unknown;
  available_credit?: unknown;
  awaiting_finance?: unknown;
  cashier_id?: unknown;
  cashier_username?: unknown;
  cashiers?: unknown;
  category?: unknown;
  columns?: unknown;
  confirmation_deadline?: unknown;
  confirmation_deadline_hours?: unknown;
  consumption_date?: unknown;
  created_at?: unknown;
  credit_limit?: unknown;
  current_price?: unknown;
  description?: unknown;
  decided_at?: unknown;
  decided_by?: unknown;
  details?: unknown;
  difference?: unknown;
  dispute_reason?: unknown;
  disputed?: unknown;
  entered_by?: unknown;
  entity_id?: unknown;
  entity_type?: unknown;
  entry_date?: unknown;
  entry_type?: unknown;
  exceeds_limit?: unknown;
  expected_total?: unknown;
  finance_managers?: unknown;
  full_name?: unknown;
  guest?: unknown;
  guest_count?: unknown;
  guest_id?: unknown;
  guest_name?: unknown;
  guests_over_limit_list?: unknown;
  historical_debt?: unknown;
  historical_debt_expected_total?: unknown;
  hotel_name?: unknown;
  id?: unknown;
  is_active?: unknown;
  items?: unknown;
  ledger?: unknown;
  line_total?: unknown;
  message?: unknown;
  method?: unknown;
  name?: unknown;
  new_credit_limit?: unknown;
  new_price?: unknown;
  notification_type?: unknown;
  outstanding_debt?: unknown;
  over_limit?: unknown;
  payment_date?: unknown;
  price_reason?: unknown;
  price_status?: unknown;
  pending_approvals?: unknown;
  pending_exceptional_approvals?: unknown;
  pending_guest_confirmations?: unknown;
  pending_price_approval?: unknown;
  pending_reservations?: unknown;
  phone?: unknown;
  previous_balance?: unknown;
  previous_credit_limit?: unknown;
  proposed_price?: unknown;
  price_request_id?: unknown;
  requested_price?: unknown;
  request_kind?: unknown;
  quantity?: unknown;
  read_at?: unknown;
  reason?: unknown;
  receipt_number?: unknown;
  recent_activity?: unknown;
  recent_transactions?: unknown;
  recorded_by?: unknown;
  reference_number?: unknown;
  rejected?: unknown;
  rejection_reason?: unknown;
  remaining_balance?: unknown;
  requested_by?: unknown;
  requester?: unknown;
  requires_exception?: unknown;
  role?: unknown;
  rows?: unknown;
  service_id?: unknown;
  service_name?: unknown;
  service_name_snapshot?: unknown;
  services?: unknown;
  status?: unknown;
  supporting_reference?: unknown;
  title?: unknown;
  total_amount?: unknown;
  total_approved_credits?: unknown;
  total_guests?: unknown;
  total_payments?: unknown;
  total_transactions?: unknown;
  total_users?: unknown;
  total_verified_payments?: unknown;
  transaction_code?: unknown;
  transaction_id?: unknown;
  transactions?: unknown;
  unit_price?: unknown;
  username?: unknown;
  verified_at?: unknown;
  verified_by?: unknown;
  verified_opening_balances_total?: unknown;
}

export function phpRow(value: unknown): PhpRow {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as PhpRow : {};
}

export function phpRows(value: unknown): PhpRow[] {
  return Array.isArray(value) ? value.map(phpRow) : [];
}

export function phpText(value: unknown, fallback = ""): string {
  return value === null || value === undefined ? fallback : String(value);
}

export function phpNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function phpBool(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

export function phpDate(value: unknown): string {
  const date = phpText(value);
  return date ? date.replace(" ", "T") : "";
}

export function mapPhpRole(role: unknown): StaffUser["role"] | "guest" {
  switch (role) {
    case "system_administrator": return "admin";
    case "owner": return "owner";
    case "cashier": return "cashier";
    case "finance_manager": return "finance";
    case "guest": return "guest";
    default: throw new Error(`Unsupported backend role: ${String(role)}`);
  }
}

export function mapPhpAccountStatus(active: unknown): AccountStatus {
  return phpBool(active) ? "active" : "inactive";
}

export function mapPhpGuest(row: PhpRow): Guest {
  return {
    id: phpText(row.guest_id ?? row.id),
    fullName: phpText(row.full_name ?? row.guest),
    phone: phpText(row.phone),
    username: phpText(row.username),
    status: row.status === "inactive" || (row.is_active !== undefined && !phpBool(row.is_active)) ? "inactive" : "active",
    creditLimit: phpNumber(row.credit_limit),
    createdAt: phpDate(row.created_at),
  };
}

export function mapPhpAccount(row: PhpRow): GuestAccount {
  return {
    ...mapPhpGuest(row),
    historicalDebt: phpNumber(row.historical_debt),
    approvedCredit: phpNumber(row.approved_credit),
    totalPayments: phpNumber(row.total_payments),
    outstandingDebt: phpNumber(row.outstanding_debt),
    pendingReservations: phpNumber(row.pending_reservations),
    availableCredit: phpNumber(row.available_credit),
    exceedsLimit: phpBool(row.exceeds_limit ?? row.over_limit),
  };
}

export function mapPhpTransactionStatus(status: unknown): TransactionStatus {
  switch (status) {
    case "draft": return "draft";
    case "pending_guest_confirmation": return "pending_guest";
    case "pending_finance_approval": return "pending_finance";
    case "pending_exceptional_approval": return "pending_exception";
    case "pending_price_approval": return "pending_price_approval";
    case "disputed":
    case "approved":
    case "rejected":
    case "expired":
    case "cancelled": return status;
    default: throw new Error(`Unsupported backend transaction status: ${String(status)}`);
  }
}

export function toPhpTransactionStatus(status: TransactionStatus): string {
  switch (status) {
    case "pending_guest": return "pending_guest_confirmation";
    case "pending_finance": return "pending_finance_approval";
    case "pending_exception": return "pending_exceptional_approval";
    default: return status;
  }
}

export function mapPhpTransaction(row: PhpRow): CreditTransaction {
  const id = phpText(row.id);
  const items = phpRows(row.items).map((item) => {
    const priceStatus = item["price_status"];
    const priceRequest = priceStatus === "pending" || priceStatus === "approved" || priceStatus === "rejected"
      ? {
          requestedPrice: phpNumber(item["requested_price"]),
          reason: phpText(item["price_reason"]),
          status: priceStatus,
        } satisfies NonNullable<TransactionItem["priceRequest"]>
      : undefined;
    return {
      serviceId: phpText(item["service_id"]),
      serviceName: phpText(item["service_name"] ?? item["service_name_snapshot"]),
      category: "other" as ServiceCategory,
      quantity: phpNumber(item["quantity"]),
      unitPrice: phpNumber(item["unit_price"]),
      catalogPrice: phpNumber(item["catalog_price"] ?? item["unit_price"]),
      ...(priceRequest ? { priceRequest } : {}),
      total: phpNumber(item["line_total"]),
    };
  });
  const status = mapPhpTransactionStatus(row.status);
  return {
    id,
    code: `HH-${id.padStart(8, "0")}`,
    guestId: phpText(row.guest_id),
    guestName: phpText(row.full_name ?? row.guest_name),
    items,
    total: phpNumber(row.total_amount),
    consumptionDate: phpText(row.consumption_date),
    createdAt: phpDate(row.created_at),
    createdBy: phpText(row.cashier_username ?? row.cashier_id),
    status,
    confirmationDeadline: row.confirmation_deadline ? phpDate(row.confirmation_deadline) : undefined,
    exceedsLimit: phpBool(row.requires_exception),
    excessAmount: 0,
    revision: 1,
    disputeReason: row.dispute_reason ? phpText(row.dispute_reason) : undefined,
    rejectionReason: row.rejection_reason ? phpText(row.rejection_reason) : undefined,
    history: phpRows(row["history"]).map((event) => {
      const note = phpText(event["note"]);
      return {
        at: phpDate(event["at"]),
        by: phpText(event["by"], "System"),
        action: phpText(event["action"], "Transaction updated"),
        ...(note ? { note } : {}),
      };
    }),
  };
}

export function mapPhpPayment(row: PhpRow): Payment {
  const verified = row.status === "verified";
  return {
    id: phpText(row.id),
    receiptNumber: phpText(row.receipt_number, `PENDING-${phpText(row.id)}`),
    guestId: phpText(row.guest_id),
    guestName: phpText(row.full_name ?? row.guest_name),
    amount: phpNumber(row.amount),
    method: row.method === "bank_transfer" ? "bank_transfer" : "cash",
    reference: row.reference_number ? phpText(row.reference_number) : undefined,
    paidAt: phpDate(row.payment_date),
    recordedBy: phpText(row.recorded_by),
    verified,
    balanceBefore: phpNumber(row.previous_balance),
    balanceAfter: phpNumber(row.remaining_balance),
  };
}

export function mapPhpHistorical(row: PhpRow): HistoricalDebt {
  const status = row.status === "verified" ? "approved" : row.status;
  return {
    id: phpText(row.id),
    guestId: phpText(row.guest_id),
    guestName: phpText(row.full_name ?? row.guest_name),
    amount: phpNumber(row.amount),
    sourceReference: phpText(row.supporting_reference),
    originalDate: phpText(row.applicable_from),
    status: status === "rejected" ? "rejected" : status === "approved" ? "approved" : "pending_verification",
    enteredBy: phpText(row.entered_by),
    enteredAt: phpDate(row.created_at),
    verifiedBy: row.verified_by ? phpText(row.verified_by) : undefined,
    verifiedAt: row.verified_at ? phpDate(row.verified_at) : undefined,
  };
}

export function mapPhpService(row: PhpRow): HotelService {
  const category = phpText(row.category).toLowerCase();
  const categoryMap: Record<string, ServiceCategory> = {
    food: "food",
    drinks: "drinks",
    accommodation: "accommodation",
    other: "other",
  };
  return {
    id: phpText(row.id),
    name: phpText(row.name),
    category: categoryMap[category] ?? "other",
    price: phpNumber(row.current_price),
    available: phpBool(row.is_active),
    priceHistory: [],
  };
}

export function mapPhpPriceRequest(row: PhpRow): PriceRequest {
  const kind = row.request_kind === "transaction" ? "transaction" : "catalog";
  return {
    id: phpText(row.id),
    kind,
    serviceId: phpText(row.service_id),
    serviceName: phpText(row.service_name),
    currentPrice: phpNumber(row.current_price),
    requestedPrice: phpNumber(row.proposed_price),
    reason: phpText(row.reason),
    requestedBy: phpText(row.requester ?? row.requested_by),
    requestedAt: phpDate(row.created_at),
    status: row.status === "approved" || row.status === "rejected" ? row.status : "pending",
    ...(row.transaction_id !== undefined && row.transaction_id !== null ? { transactionId: phpText(row.transaction_id) } : {}),
    ...(row.transaction_code ? { transactionCode: phpText(row.transaction_code) } : {}),
    ...(row.decided_by ? { decidedBy: phpText(row.decided_by) } : {}),
    ...(row.decided_at ? { decidedAt: phpDate(row.decided_at) } : {}),
  };
}
