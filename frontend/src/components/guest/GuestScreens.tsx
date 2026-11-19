import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { BadgeCheck, Bell, Eye, Flag, Hourglass, Trash2, WalletCards } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { CreditSummary } from "@/components/common/CreditSummary";
import {
  PORTAL_MODAL_CONTENT_CLASS,
  PORTAL_MODAL_OVERLAY_CLASS,
  PORTAL_MODAL_SCROLL_CLASS,
  PORTAL_WIDE_MODAL_CONTENT_CLASS,
} from "@/components/common/modal-styles";
import { GuestDebtDetails } from "@/components/guest/GuestDebtDetails";
import { PaginationControls } from "@/components/common/PaginationControls";
import { PageHeader, SectionTitle } from "@/components/common/PageHeader";
import { Field, Panel } from "@/components/common/Panel";
import { ReasonDialog } from "@/components/common/ReasonDialog";
import { EmptyState, Spinner } from "@/components/common/States";
import { TX_STATUS_LABEL, TxStatusBadge } from "@/components/common/StatusBadge";
import {
  PaymentMethodBadge,
  PaymentsTable,
  ReceiptButton,
} from "@/components/finance/PaymentParts";
import {
  ItemsTable,
  TransactionDetail,
  TransactionsTable,
} from "@/components/transactions/TransactionParts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";
import { usePaginatedItems } from "@/hooks/use-pagination";
import { cn } from "@/lib/utils";
import { date, dateTime, fromNow, money } from "@/lib/format";
import { q } from "@/lib/queries";
import { errorMessage } from "@/services/http";
import { guestSelfService } from "@/services/finance.service";
import { transactionsService } from "@/services/transactions.service";
import type { CreditTransaction, TransactionStatus } from "@/types";
import { toast } from "sonner";

const byNewest =
  <T,>(key: (x: T) => string) =>
  (a: T, b: T) =>
    Date.parse(key(b)) - Date.parse(key(a));

export function GuestDashboard() {
  const { data } = useSuspenseQuery(q.guestDashboard());
  const read = useAction(() => guestSelfService.markNotificationsRead());
  const removeNotification = useAction((id: string) => guestSelfService.deleteNotification(id), {
    success: "Notification deleted.",
  });
  const [clearNotificationsOpen, setClearNotificationsOpen] = useState(false);
  const clearNotifications = useAction(() => guestSelfService.clearNotifications(), {
    success: "All notifications cleared.",
    onSuccess: () => setClearNotificationsOpen(false),
  });
  const unread = data.notifications.filter((n) => !n.read).length;
  const first = data.account.fullName.split(" ")[0] ?? data.account.fullName;
  const activityPagination = usePaginatedItems([...data.activity].sort(byNewest((a) => a.at)));
  const notificationPagination = usePaginatedItems(
    [...data.notifications].sort(byNewest((n) => n.at)),
    "",
    6,
  );
  const [debtDetailsOpen, setDebtDetailsOpen] = useState(false);
  const [pendingOpen, setPendingOpen] = useState(false);

  return (
    <>
      <PageHeader
        eyebrow="My account"
        title={`Welcome, ${first}`}
        description="Your credit position at Haroni Hotel, charges waiting for you, and recent activity."
      />
      <CreditSummary account={data.account} />
      <div className="mt-4">
        <Button variant="outline" onClick={() => setDebtDetailsOpen(true)} aria-haspopup="dialog">
          <WalletCards className="h-4 w-4" />
          View debt details
        </Button>
      </div>
      {data.pending.length > 0 ? (
        <Panel className="mt-6 border-primary/35 bg-gold-soft" delay={60}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <Hourglass className="mt-1 h-5 w-5 text-primary" />
              <div>
                <h2 className="font-display text-xl font-semibold">
                  {data.pending.length} charge{data.pending.length === 1 ? "" : "s"} waiting for
                  your confirmation
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Confirm only services you received. Dispute anything that is wrong.
                </p>
              </div>
            </div>
            <Button onClick={() => setPendingOpen(true)}>Review now</Button>
          </div>
        </Panel>
      ) : (
        <Panel className="mt-6" delay={60}>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <BadgeCheck className="h-5 w-5 text-success" /> Nothing is waiting for your
            confirmation.
          </div>
        </Panel>
      )}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel delay={120} className="min-w-0">
          <SectionTitle
            title="Recent activity"
            action={
              <Button variant="link" size="sm" onClick={() => setDebtDetailsOpen(true)}>
                Debt details
              </Button>
            }
          />
          {data.activity.length ? (
            <ul className="divide-y">
              {activityPagination.currentItems.map((a, i) => (
                <li key={`${a.at}-${i}`} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{a.title}</p>
                    <p className="text-xs text-muted-foreground">{dateTime(a.at)}</p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 font-semibold tabular-nums",
                      a.kind === "payment" ? "text-success" : "text-foreground",
                    )}
                  >
                    {a.kind === "payment" ? "−" : ""}
                    {money(a.amount)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No activity yet" />
          )}
          {data.activity.length > 0 && <PaginationControls {...activityPagination} />}
        </Panel>
        <Panel delay={180} className="min-w-0">
          <SectionTitle
            title="Notifications"
            action={
              <div className="flex flex-wrap items-center justify-end gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!unread || read.isPending}
                  onClick={() => read.mutate(undefined)}
                >
                  Mark all read
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  disabled={
                    !data.notifications.length ||
                    removeNotification.isPending ||
                    clearNotifications.isPending
                  }
                  onClick={() => setClearNotificationsOpen(true)}
                >
                  <Trash2 className="h-4 w-4" /> Clear all
                </Button>
              </div>
            }
          />
          {data.notifications.length ? (
            <ul className="space-y-3">
              {notificationPagination.currentItems.map((n) => (
                <li
                  key={n.id}
                  className={cn(
                    "rounded-lg border p-3",
                    n.read ? "bg-surface" : "border-primary/30 bg-primary/5",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-semibold">
                        {!n.read && <Bell className="h-3.5 w-3.5 shrink-0 text-primary" />}
                        {n.title}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">{n.body}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{fromNow(n.at)}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label={`Delete notification: ${n.title}`}
                      disabled={removeNotification.isPending || clearNotifications.isPending}
                      onClick={() => removeNotification.mutate(n.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No notifications" />
          )}
          {data.notifications.length > 0 && <PaginationControls {...notificationPagination} />}
          <ConfirmDialog
            open={clearNotificationsOpen}
            onOpenChange={setClearNotificationsOpen}
            title="Clear all notifications?"
            description="This permanently removes all of your notifications."
            confirmLabel="Clear all"
            onConfirm={() => clearNotifications.mutate(undefined)}
          />
        </Panel>
      </div>
      <Dialog open={debtDetailsOpen} onOpenChange={setDebtDetailsOpen}>
        <DialogContent
          overlayClassName={PORTAL_MODAL_OVERLAY_CLASS}
          scrollAreaClassName={PORTAL_MODAL_SCROLL_CLASS}
          className={PORTAL_WIDE_MODAL_CONTENT_CLASS}
        >
          <DialogHeader className="sticky top-0 z-10 bg-background/95 pb-2 pr-10 backdrop-blur">
            <DialogTitle className="font-display text-xl">Debt details</DialogTitle>
            <DialogDescription>
              View your balance breakdown, approved charges and payments.
            </DialogDescription>
          </DialogHeader>
          <Suspense
            fallback={
              <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
                <Spinner className="h-4 w-4" /> Loading debt details...
              </div>
            }
          >
            <GuestDebtDetails embedded />
          </Suspense>
        </DialogContent>
      </Dialog>
      <Dialog open={pendingOpen} onOpenChange={setPendingOpen}>
        <DialogContent
          overlayClassName={PORTAL_MODAL_OVERLAY_CLASS}
          scrollAreaClassName={PORTAL_MODAL_SCROLL_CLASS}
          className={PORTAL_WIDE_MODAL_CONTENT_CLASS}
        >
          <DialogHeader className="sticky top-0 z-10 bg-background/95 pb-2 pr-10 backdrop-blur">
            <DialogTitle className="font-display text-xl">Pending confirmation</DialogTitle>
            <DialogDescription>
              Review charges recorded on your account and confirm or dispute them.
            </DialogDescription>
          </DialogHeader>
          <Suspense
            fallback={
              <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
                <Spinner className="h-4 w-4" /> Loading pending charges...
              </div>
            }
          >
            <GuestPending embedded />
          </Suspense>
        </DialogContent>
      </Dialog>
    </>
  );
}

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

function Countdown({ deadline, now }: { deadline?: string | undefined; now: number }) {
  if (!deadline) return null;
  const ms = Date.parse(deadline) - now;
  if (ms <= 0)
    return (
      <span className="text-sm font-medium text-destructive">Confirmation time has passed</span>
    );
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return (
    <span className={cn("text-sm font-medium", h < 6 ? "text-warning" : "text-muted-foreground")}>
      {h > 0 ? `${h}h ${m}m` : `${m}m`} left to respond · by {dateTime(deadline)}
    </span>
  );
}

export function GuestPending({ embedded = false }: { embedded?: boolean }) {
  const { data: rows } = useSuspenseQuery(q.transactions({ status: "pending_guest" }));
  const now = useNow();
  const [confirming, setConfirming] = useState<CreditTransaction | null>(null);
  const [disputing, setDisputing] = useState<CreditTransaction | null>(null);
  const confirm = useAction((id: string) => transactionsService.confirm(id), {
    success: "Thank you — charge confirmed.",
    onSuccess: () => setConfirming(null),
  });
  const dispute = useAction(
    (v: { id: string; reason: string }) => transactionsService.dispute(v.id, v.reason),
    { success: "Dispute sent to the cashier.", onSuccess: () => setDisputing(null) },
  );

  return (
    <>
      {!embedded && (
        <PageHeader
          eyebrow="Transactions"
          title="Pending confirmation"
          description="Check each charge carefully. Confirm only services you received; dispute anything that is wrong."
        />
      )}
      {!rows.length && (
        <EmptyState
          icon={<BadgeCheck className="h-5 w-5" />}
          title="All caught up"
          description="New charges from the hotel will appear here for you to confirm."
        />
      )}
      <div className={embedded ? "space-y-3" : "space-y-6"}>
        {rows.map((tx, i) => (
          <Panel key={tx.id} delay={i * 50} className={embedded ? "p-4 sm:p-4" : undefined}>
            <div
              className={cn(
                "flex flex-wrap items-start justify-between gap-3",
                embedded ? "mb-3" : "mb-4",
              )}
            >
              <div>
                <div
                  className={cn("font-display font-semibold", embedded ? "text-xl" : "text-2xl")}
                >
                  {tx.code}
                </div>
                <div className="text-sm text-muted-foreground">
                  Services on {date(tx.consumptionDate)} · recorded by {tx.createdBy}
                </div>
              </div>
              <TxStatusBadge status={tx.status} />
            </div>
            <ItemsTable tx={tx} />
            <div
              className={cn(
                "mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between",
                embedded ? "gap-3" : "gap-4",
              )}
            >
              <Countdown deadline={tx.confirmationDeadline} now={now} />
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size={embedded ? "sm" : "default"}
                  className="flex-1 sm:flex-none"
                  onClick={() => setDisputing(tx)}
                >
                  <Flag className="h-4 w-4" /> Dispute
                </Button>
                <Button
                  size={embedded ? "sm" : "default"}
                  className="flex-1 sm:flex-none"
                  onClick={() => setConfirming(tx)}
                >
                  <BadgeCheck className="h-4 w-4" /> Confirm {money(tx.total)}
                </Button>
              </div>
            </div>
          </Panel>
        ))}
      </div>
      <ConfirmDialog
        open={Boolean(confirming)}
        onOpenChange={(o) => !o && setConfirming(null)}
        title={`Confirm ${confirming?.code ?? ""}?`}
        description={`You confirm you received these services, totalling ${confirming ? money(confirming.total) : ""}. The Finance Manager then approves it and it is added to your balance.`}
        confirmLabel="Yes, confirm"
        onConfirm={() => confirming && !confirm.isPending && confirm.mutate(confirming.id)}
      />
      <ReasonDialog
        open={Boolean(disputing)}
        onOpenChange={(o) => !o && setDisputing(null)}
        title={`Dispute ${disputing?.code ?? ""}`}
        description="Tell the hotel what is wrong — for example a service you did not take or a wrong quantity."
        placeholder="What is wrong with this charge?"
        confirmLabel="Send dispute"
        confirmVariant="destructive"
        pending={dispute.isPending}
        onSubmit={(reason) => disputing && dispute.mutate({ id: disputing.id, reason })}
      />
    </>
  );
}

export function GuestHistory() {
  const { data } = useSuspenseQuery(q.transactions());
  const [status, setStatus] = useState<TransactionStatus | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedQuery = useQuery({
    ...q.transaction(selectedId ?? ""),
    enabled: selectedId !== null,
  });
  const rows = data
    .filter((t) => status === "all" || t.status === status)
    .sort(byNewest((t) => t.createdAt));

  return (
    <>
      <PageHeader
        eyebrow="Transactions"
        title="Transaction history"
        description="Every charge recorded on your account and what happened to it."
      />
      <Select value={status} onValueChange={(v) => setStatus(v as TransactionStatus | "all")}>
        <SelectTrigger className="mb-4 w-full bg-surface sm:w-60" aria-label="Filter by status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          {(Object.keys(TX_STATUS_LABEL) as TransactionStatus[]).map((s) => (
            <SelectItem key={s} value={s}>
              {TX_STATUS_LABEL[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <TransactionsTable
        rows={rows}
        showGuest={false}
        empty="No transactions match this filter."
        actions={(t) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedId(t.id)}
            aria-label={`View ${t.code}`}
          >
            <Eye className="h-4 w-4" /> View
          </Button>
        )}
      />
      <Dialog open={selectedId !== null} onOpenChange={(o) => !o && setSelectedId(null)}>
        <DialogContent
          overlayClassName={PORTAL_MODAL_OVERLAY_CLASS}
          scrollAreaClassName={PORTAL_MODAL_SCROLL_CLASS}
          className={PORTAL_MODAL_CONTENT_CLASS}
        >
          <DialogHeader className="sticky top-0 z-10 bg-background/95 pb-2 pr-10 backdrop-blur">
            <DialogTitle className="font-display text-xl">Transaction details</DialogTitle>
            <DialogDescription>Services, confirmation and review history.</DialogDescription>
          </DialogHeader>
          {selectedQuery.isPending && (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" /> Loading transaction details...
            </div>
          )}
          {selectedQuery.isError && (
            <p role="alert" className="py-4 text-sm text-destructive">
              {errorMessage(selectedQuery.error)}
            </p>
          )}
          {selectedQuery.data && <TransactionDetail tx={selectedQuery.data.transaction} compact />}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function GuestDebt() {
  return <GuestDebtDetails />;
}

export function GuestPayments() {
  const { data: payments } = useSuspenseQuery(q.payments());
  const { data: account } = useSuspenseQuery(q.myAccount());
  const total = payments.filter((p) => p.verified).reduce((s, p) => s + p.amount, 0);
  return (
    <>
      <PageHeader
        eyebrow="Debt & payments"
        title="Payment history"
        description={`${payments.length} payment${payments.length === 1 ? "" : "s"} · ${money(total)} received in total`}
      />
      <PaymentsTable
        rows={[...payments].sort(byNewest((p) => p.paidAt))}
        showGuest={false}
        guestPhone={account.phone}
      />
    </>
  );
}

export function GuestReceipts() {
  const { data: payments } = useSuspenseQuery(q.payments());
  const { data: account } = useSuspenseQuery(q.myAccount());
  const verified = payments.filter((p) => p.verified).sort(byNewest((p) => p.paidAt));
  return (
    <>
      <PageHeader
        eyebrow="Debt & payments"
        title="Receipts"
        description="Download an official receipt for every payment the hotel has received."
      />
      {!verified.length ? (
        <EmptyState
          title="No receipts yet"
          description="A receipt appears here once the Finance Manager records your payment."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {verified.map((p, i) => (
            <Panel key={p.id} delay={Math.min(i, 8) * 40} className="flex flex-col">
              <div className="flex items-start justify-between gap-2">
                <span className="break-all font-mono text-xs text-muted-foreground">
                  {p.receiptNumber}
                </span>
                <PaymentMethodBadge method={p.method} />
              </div>
              <div className="mt-3 font-display text-3xl font-semibold text-primary">
                {money(p.amount)}
              </div>
              <div className="text-sm text-muted-foreground">{date(p.paidAt)}</div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Field label="Balance before" value={money(p.balanceBefore)} />
                <Field label="Balance after" value={money(p.balanceAfter)} />
              </div>
              <div className="mt-auto pt-5">
                <ReceiptButton
                  payment={p}
                  guestPhone={account.phone}
                  label="Download receipt"
                  variant="gold"
                  size="default"
                />
              </div>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
