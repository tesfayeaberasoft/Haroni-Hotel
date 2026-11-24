import { useSuspenseQuery } from "@tanstack/react-query";
import { Suspense, useState, type ReactNode } from "react";
import { AlertTriangle, Banknote, KeyRound, Plus, Power, UserRoundPen } from "lucide-react";
import {
  PORTAL_MODAL_CONTENT_CLASS,
  PORTAL_MODAL_OVERLAY_CLASS,
  PORTAL_MODAL_SCROLL_CLASS,
  PORTAL_WIDE_MODAL_CONTENT_CLASS,
} from "@/components/common/modal-styles";
import { CreditSummary } from "@/components/common/CreditSummary";
import { Field, Panel, TableShell } from "@/components/common/Panel";
import { SearchInput } from "@/components/common/SearchInput";
import { EmptyState, Spinner } from "@/components/common/States";
import { FormDialog, TextField } from "@/components/common/FormDialog";
import { AccountStatusBadge, HistoricalStatusBadge } from "@/components/common/StatusBadge";
import { DecisionActions } from "@/components/finance/DecisionActions";
import { PaymentsTable } from "@/components/finance/PaymentParts";
import { CreditLimitDialog } from "@/components/finance/CreditLimitDialog";
import { HistoricalRecordDialog } from "@/components/finance/HistoricalViews";
import { PaymentDetailDialog, RecordPaymentDialog } from "@/components/finance/PaymentParts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TransactionDetail, TransactionsTable } from "@/components/transactions/TransactionParts";
import { q } from "@/lib/queries";
import { date, dateTime, money } from "@/lib/format";
import { useAction } from "@/hooks/use-action";
import { guestsService } from "@/services/guests.service";
import { USE_DEMO_BACKEND } from "@/services/config";
import type {
  CreditLimitChange,
  CreditTransaction,
  AccountStatus,
  GuestAccount,
  HistoricalDebt,
  Payment,
} from "@/types";
import { GuestDialog } from "@/components/admin/GuestManagement";
import { ResetPasswordDialog } from "@/components/admin/UserManagement";

export function GuestFinanceList({
  onSelect,
  initialOverOnly = false,
  compactColumns = false,
  onRegister,
}: {
  onSelect: (guest: GuestAccount) => void;
  initialOverOnly?: boolean;
  compactColumns?: boolean;
  onRegister?: (() => void) | undefined;
}) {
  const { data } = useSuspenseQuery(q.guestAccounts());
  const [search, setSearch] = useState("");
  const [overOnly, setOverOnly] = useState(initialOverOnly);
  const term = search.toLowerCase().replace(/\s/g, "");
  const rows = data
    .filter(
      (guest) =>
        (!overOnly || guest.exceedsLimit) &&
        `${guest.fullName}${guest.username}${guest.phone}`
          .toLowerCase()
          .replace(/\s/g, "")
          .includes(term),
    )
    .sort((a, b) => b.outstandingDebt - a.outstandingDebt);
  const totalDebt = rows.reduce((sum, guest) => sum + guest.outstandingDebt, 0);

  return (
    <>
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search by name, username or phone"
          className="max-w-sm flex-1"
        />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={overOnly} onCheckedChange={setOverOnly} /> Only guests over their limit
        </label>
        {onRegister && (
          <Button size="sm" onClick={onRegister}>
            <Plus className="h-4 w-4" /> Register guest
          </Button>
        )}
      </div>
      {!rows.length ? (
        <EmptyState title="No guests found" />
      ) : (
        <TableShell>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Guest</TableHead>
                <TableHead className="hidden text-right md:table-cell">Credit limit</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Available</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((guest) => (
                <TableRow
                  key={guest.id}
                  className="cursor-pointer transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
                  tabIndex={0}
                  aria-label={`View finances for ${guest.fullName}`}
                  aria-haspopup="dialog"
                  onClick={() => onSelect(guest)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(guest);
                    }
                  }}
                >
                  <TableCell className="font-semibold">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate">{guest.fullName}</span>
                      {guest.status !== "active" && <AccountStatusBadge status={guest.status} />}
                    </div>
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap text-right tabular-nums text-muted-foreground md:table-cell">
                    {money(guest.creditLimit)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">
                    {guest.exceedsLimit && (
                      <AlertTriangle
                        className="mr-1 inline h-3.5 w-3.5 text-destructive"
                        aria-label="Over limit"
                      />
                    )}
                    {money(guest.outstandingDebt)}
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap text-right font-semibold text-primary tabular-nums sm:table-cell">
                    {money(guest.availableCredit)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-semibold">Total outstanding</TableCell>
                <TableCell className="hidden md:table-cell" />
                <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">
                  {money(totalDebt)}
                </TableCell>
                <TableCell className="hidden sm:table-cell" />
              </TableRow>
            </TableFooter>
          </Table>
        </TableShell>
      )}
    </>
  );
}

export function GuestFinanceDetailDialog({
  guestId,
  onClose,
  nested = false,
}: {
  guestId: string | null;
  onClose: () => void;
  nested?: boolean;
}) {
  if (!guestId) return null;
  return (
    <Suspense fallback={<Spinner className="fixed left-1/2 top-1/2 z-[80] h-6 w-6" />}>
      <GuestFinanceDetailBody key={guestId} guestId={guestId} nested={nested} onClose={onClose} />
    </Suspense>
  );
}

function GuestFinanceDetailBody({
  guestId,
  nested,
  onClose,
}: {
  guestId: string;
  nested: boolean;
  onClose: () => void;
}) {
  const { data } = useSuspenseQuery(q.guestDetail(guestId));
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [selectedHistorical, setSelectedHistorical] = useState<HistoricalDebt | null>(null);
  const [selectedLimitChange, setSelectedLimitChange] = useState<CreditLimitChange | null>(null);
  const [action, setAction] = useState<"historical" | "payment" | "limit" | null>(null);
  const [editingGuest, setEditingGuest] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [confirmStatusChange, setConfirmStatusChange] = useState(false);
  const { account, transactions } = data;
  const payments = data.payments ?? [];
  const historical = data.historical ?? [];
  const limitChanges = data.limitChanges ?? [];
  const actionNested = !nested;
  const actionDeep = nested;
  const changeStatus = useAction(
    (status: AccountStatus) => guestsService.setStatus(account.id, status),
    {
      success: "Guest account status updated.",
      onSuccess: () => setConfirmStatusChange(false),
    },
  );

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          overlayClassName={nested ? "z-[60] md:top-16 lg:left-72" : PORTAL_MODAL_OVERLAY_CLASS}
          scrollAreaClassName={PORTAL_MODAL_SCROLL_CLASS}
          className={`${PORTAL_WIDE_MODAL_CONTENT_CLASS} ${nested ? "z-[70]" : ""}`}
        >
          <DialogHeader>
            <DialogTitle className="font-display text-xl">{account.fullName}</DialogTitle>
            <DialogDescription>
              @{account.username} · {account.phone} · {account.status}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditingGuest(true)}
              aria-haspopup="dialog"
            >
              <UserRoundPen className="h-4 w-4" /> Edit details
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setResettingPassword(true)}
              aria-haspopup="dialog"
            >
              <KeyRound className="h-4 w-4" /> Reset password
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfirmStatusChange(true)}
              disabled={changeStatus.isPending}
            >
              <Power className="h-4 w-4" /> {account.status === "active" ? "Deactivate" : "Activate"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAction("historical")}
              aria-haspopup="dialog"
            >
              <Plus className="h-4 w-4" /> Add record
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAction("payment")}
              aria-haspopup="dialog"
            >
              <Banknote className="h-4 w-4" /> Record payment
            </Button>
            <Button
              size="sm"
              variant="gold"
              onClick={() => setAction("limit")}
              aria-haspopup="dialog"
            >
              <KeyRound className="h-4 w-4" /> Change limit
            </Button>
          </div>
          <CreditSummary account={account} compact />
          <div className="grid gap-2 rounded-lg border bg-surface p-3 text-sm sm:grid-cols-2">
            <div><span className="text-muted-foreground">Username:</span> @{account.username}</div>
            <div><span className="text-muted-foreground">Phone:</span> {account.phone || "—"}</div>
            <div><span className="text-muted-foreground">Status:</span> <AccountStatusBadge status={account.status} /></div>
            <div><span className="text-muted-foreground">Registered:</span> {account.createdAt ? dateTime(account.createdAt) : "—"}</div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Panel className="p-3 sm:p-4">
              <div className="text-xs text-muted-foreground">Opening balance</div>
              <div className="font-semibold tabular-nums">{money(account.historicalDebt)}</div>
            </Panel>
            <Panel className="p-3 sm:p-4">
              <div className="text-xs text-muted-foreground">Approved credit</div>
              <div className="font-semibold tabular-nums">{money(account.approvedCredit)}</div>
            </Panel>
            <Panel className="p-3 sm:p-4">
              <div className="text-xs text-muted-foreground">Payments</div>
              <div className="font-semibold text-success tabular-nums">
                {money(account.totalPayments)}
              </div>
            </Panel>
          </div>
          <Tabs defaultValue="transactions">
            <TabsList className="h-auto flex-wrap">
              <TabsTrigger value="transactions">Transactions ({transactions.length})</TabsTrigger>
              <TabsTrigger value="payments">Payments ({payments.length})</TabsTrigger>
              <TabsTrigger value="historical">Opening balance ({historical.length})</TabsTrigger>
              <TabsTrigger value="limits">Limit changes ({limitChanges.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="transactions" className="mt-3">
              <TransactionsTable
                rows={transactions}
                showGuest={false}
                onRowClick={(transaction) => setTransactionId(transaction.id)}
              />
            </TabsContent>
            <TabsContent value="payments" className="mt-3">
              <PaymentsTable
                rows={payments}
                showGuest={false}
                guestPhone={account.phone}
                onRowClick={setSelectedPayment}
              />
            </TabsContent>
            <TabsContent value="historical" className="mt-3">
              {!historical.length ? (
                <EmptyState title="No opening balance records" />
              ) : (
                <TableShell>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Source</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {historical.map((record) => (
                        <TableRow
                          key={record.id}
                          className="cursor-pointer hover:bg-muted/60"
                          tabIndex={0}
                          aria-label={`View opening balance record for ${record.guestName}`}
                          onClick={() => setSelectedHistorical(record)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelectedHistorical(record);
                            }
                          }}
                        >
                          <TableCell className="font-medium">{record.sourceReference}</TableCell>
                          <TableCell>{date(record.originalDate)}</TableCell>
                          <TableCell>
                            <HistoricalStatusBadge status={record.status} />
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            {money(record.amount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableShell>
              )}
            </TabsContent>
            <TabsContent value="limits" className="mt-3">
              {!limitChanges.length ? (
                <EmptyState title="The limit has never been changed" />
              ) : (
                <TableShell>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>When</TableHead>
                        <TableHead className="text-right">From</TableHead>
                        <TableHead className="text-right">To</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>By</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {limitChanges.map((change) => (
                        <TableRow
                          key={change.id}
                          className="cursor-pointer hover:bg-muted/60"
                          tabIndex={0}
                          aria-label={`View credit limit change for ${change.guestName}`}
                          onClick={() => setSelectedLimitChange(change)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelectedLimitChange(change);
                            }
                          }}
                        >
                          <TableCell className="whitespace-nowrap text-sm">
                            {dateTime(change.changedAt)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {money(change.previousLimit)}
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            {money(change.newLimit)}{" "}
                            <Badge
                              variant={
                                change.newLimit >= change.previousLimit ? "success" : "warning"
                              }
                            >
                              {change.newLimit >= change.previousLimit ? "↑" : "↓"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {change.reason}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">
                            {change.changedBy}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableShell>
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
      <FinanceTransactionDetailDialog
        transactionId={transactionId}
        nested={!nested}
        deep={nested}
        onClose={() => setTransactionId(null)}
      />
      <PaymentDetailDialog
        payment={selectedPayment}
        nested={!nested}
        deep={nested}
        onClose={() => setSelectedPayment(null)}
      />
      <HistoricalDetailDialog
        record={selectedHistorical}
        nested={!nested}
        deep={nested}
        onClose={() => setSelectedHistorical(null)}
      />
      <LimitChangeDetailDialog
        change={selectedLimitChange}
        nested={!nested}
        deep={nested}
        onClose={() => setSelectedLimitChange(null)}
      />
      {action === "historical" && (
        <HistoricalRecordDialog
          initialGuestId={account.id}
          nested={actionNested}
          deep={actionDeep}
          onClose={() => setAction(null)}
        />
      )}
      {action === "payment" && (
        <RecordPaymentDialog
          account={account}
          nested={actionNested}
          deep={actionDeep}
          onClose={() => setAction(null)}
        />
      )}
      {action === "limit" && (
        <CreditLimitDialog
          account={account}
          nested={actionNested}
          deep={actionDeep}
          onClose={() => setAction(null)}
        />
      )}
      {editingGuest && (
        <GuestDialog
          guest={account}
          nested={!nested}
          deep={nested}
          onClose={() => setEditingGuest(false)}
        />
      )}
      {resettingPassword && (
        <ResetPasswordDialog
          id={account.id}
          name={account.fullName}
          nested={!nested}
          deep={nested}
          onClose={() => setResettingPassword(false)}
        />
      )}
      <ConfirmDialog
        open={confirmStatusChange}
        onOpenChange={setConfirmStatusChange}
        nested={!nested}
        deep={nested}
        title={account.status === "active" ? "Deactivate this guest account?" : "Activate this guest account?"}
        description={
          account.status === "active"
            ? "The guest will no longer be able to sign in until the account is reactivated."
            : "The guest will be able to sign in and use their account again."
        }
        confirmLabel={account.status === "active" ? "Deactivate" : "Activate"}
        onConfirm={() => changeStatus.mutate(account.status === "active" ? "inactive" : "active")}
      />
    </>
  );
}

export function FinanceTransactionDetailDialog({
  transactionId,
  onClose,
  nested = false,
  deep = false,
}: {
  transactionId: string | null;
  onClose: () => void;
  nested?: boolean;
  deep?: boolean;
}) {
  if (!transactionId) return null;
  return (
    <Suspense fallback={<Spinner className="fixed left-1/2 top-1/2 z-[90] h-6 w-6" />}>
      <FinanceTransactionDetailBody
        key={transactionId}
        transactionId={transactionId}
        nested={nested}
        deep={deep}
        onClose={onClose}
      />
    </Suspense>
  );
}

function HistoricalDetailDialog({
  record,
  nested,
  deep,
  onClose,
}: {
  record: HistoricalDebt | null;
  nested: boolean;
  deep: boolean;
  onClose: () => void;
}) {
  if (!record) return null;
  return (
    <GuestItemDetailDialog
      title={`Opening balance · ${record.guestName}`}
      nested={nested}
      deep={deep}
      onClose={onClose}
    >
      <Field label="Amount" value={money(record.amount)} />
      <Field label="Source reference" value={record.sourceReference} />
      <Field label="Original date" value={date(record.originalDate)} />
      <Field label="Evidence note" value={record.evidenceNote ?? "—"} />
      <Field label="Status" value={<HistoricalStatusBadge status={record.status} />} />
      <Field label="Entered by" value={record.enteredBy} />
      <Field label="Entered at" value={dateTime(record.enteredAt)} />
      <Field label="Verified by" value={record.verifiedBy ?? "—"} />
      <Field label="Verified at" value={record.verifiedAt ? dateTime(record.verifiedAt) : "—"} />
    </GuestItemDetailDialog>
  );
}

function LimitChangeDetailDialog({
  change,
  nested,
  deep,
  onClose,
}: {
  change: CreditLimitChange | null;
  nested: boolean;
  deep: boolean;
  onClose: () => void;
}) {
  if (!change) return null;
  return (
    <GuestItemDetailDialog
      title={`Credit limit change · ${change.guestName}`}
      nested={nested}
      deep={deep}
      onClose={onClose}
    >
      <Field label="Previous limit" value={money(change.previousLimit)} />
      <Field label="New limit" value={money(change.newLimit)} />
      <Field label="Reason" value={change.reason} />
      <Field label="Changed by" value={change.changedBy} />
      <Field label="Changed at" value={dateTime(change.changedAt)} />
    </GuestItemDetailDialog>
  );
}

function GuestItemDetailDialog({
  title,
  nested,
  deep,
  onClose,
  children,
}: {
  title: string;
  nested: boolean;
  deep: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        overlayClassName={
          deep
            ? "z-[80] md:top-16 lg:left-72"
            : nested
              ? "z-[60] md:top-16 lg:left-72"
              : PORTAL_MODAL_OVERLAY_CLASS
        }
        scrollAreaClassName={PORTAL_MODAL_SCROLL_CLASS}
        className={`${PORTAL_MODAL_CONTENT_CLASS} ${deep ? "z-[90]" : nested ? "z-[70]" : ""}`}
      >
        <DialogHeader>
          <DialogTitle className="font-display text-xl">{title}</DialogTitle>
          <DialogDescription>Full record details.</DialogDescription>
        </DialogHeader>
        <Panel className="space-y-3 p-3 sm:p-4">{children}</Panel>
      </DialogContent>
    </Dialog>
  );
}

function FinanceTransactionDetailBody({
  transactionId,
  nested,
  deep,
  onClose,
}: {
  transactionId: string;
  nested: boolean;
  deep: boolean;
  onClose: () => void;
}) {
  const { data } = useSuspenseQuery(q.transaction(transactionId));
  const transaction: CreditTransaction = data.transaction;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        overlayClassName={
          deep
            ? "z-[80] md:top-16 lg:left-72"
            : nested
              ? "z-[60] md:top-16 lg:left-72"
              : PORTAL_MODAL_OVERLAY_CLASS
        }
        scrollAreaClassName={PORTAL_MODAL_SCROLL_CLASS}
        className={`${PORTAL_MODAL_CONTENT_CLASS} ${deep ? "z-[90]" : nested ? "z-[70]" : ""}`}
      >
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Transaction {transaction.code}</DialogTitle>
          <DialogDescription>Full transaction information and audit trail.</DialogDescription>
        </DialogHeader>
        <TransactionDetail tx={transaction} compact />
        {(transaction.status === "pending_finance" || transaction.status === "pending_exception") && (
          <div className="border-t pt-3">
            <DecisionActions tx={transaction} onDone={onClose} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
