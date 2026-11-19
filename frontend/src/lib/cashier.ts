import type { AuthUser, CreditTransaction, GuestAccount, TransactionStatus } from "@/types";

const CORRECTABLE_STATUSES: TransactionStatus[] = [
  "disputed",
  "pending_guest",
  "pending_price_approval",
];
const CANCELLABLE_STATUSES: TransactionStatus[] = [
  "draft",
  "disputed",
  "pending_guest",
  "pending_price_approval",
];
const ACTION_STATUSES: TransactionStatus[] = [...CANCELLABLE_STATUSES, "expired"];

export function cashierTransactionActionAccess(
  transaction: Pick<CreditTransaction, "createdBy" | "status">,
  cashier: Pick<AuthUser, "fullName" | "username"> | undefined,
  demoBackend: boolean,
) {
  const isOwner =
    cashier !== undefined &&
    (transaction.createdBy === cashier.fullName || transaction.createdBy === cashier.username);
  return {
    isOwner,
    showSection: ACTION_STATUSES.includes(transaction.status),
    canCorrect:
      isOwner &&
      (transaction.status === "draft" || CORRECTABLE_STATUSES.includes(transaction.status)),
    canCancel:
      isOwner &&
      (CANCELLABLE_STATUSES.includes(transaction.status) ||
        (demoBackend && transaction.status === "expired")),
  };
}

export function cashierLimitStatusMessage(
  tx: Pick<CreditTransaction, "code" | "status" | "exceedsLimit">,
) {
  if (tx.status === "pending_price_approval") {
    return `${tx.code} sent to Finance for price approval. Credit-limit status will be confirmed after price approval.`;
  }
  return tx.exceedsLimit
    ? `${tx.code} sent to the guest to confirm. Credit limit exceeded; exceptional Finance approval will be required.`
    : `${tx.code} sent to the guest to confirm. Credit limit not exceeded.`;
}

export function cashierSafeNote(note: string | undefined, showCreditAmounts: boolean) {
  if (!note || showCreditAmounts) return note;
  return /\b(?:credit|limit|balance|debt|reservations?)\b/i.test(note)
    ? "Credit-related account details are hidden from cashiers."
    : note;
}

export function cashierSafeGuestAccount(account: GuestAccount): GuestAccount {
  return {
    ...account,
    creditLimit: 0,
    historicalDebt: 0,
    approvedCredit: 0,
    totalPayments: 0,
    outstandingDebt: 0,
    pendingReservations: 0,
    availableCredit: 0,
    exceedsLimit: false,
  };
}
