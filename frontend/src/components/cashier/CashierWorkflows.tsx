import { useSuspenseQuery } from "@tanstack/react-query";
import { KeyRound, MessageSquareText, Pencil, XCircle } from "lucide-react";
import { Suspense, useState } from "react";
import { GuestPicker } from "@/components/common/GuestPicker";
import { SectionTitle } from "@/components/common/PageHeader";
import { PaginationControls } from "@/components/common/PaginationControls";
import { Panel } from "@/components/common/Panel";
import { ReasonDialog } from "@/components/common/ReasonDialog";
import { Spinner } from "@/components/common/States";
import { TX_STATUS_LABEL } from "@/components/common/StatusBadge";
import { SearchInput } from "@/components/common/SearchInput";
import {
  CASHIER_DETAIL_MODAL_CONTENT_CLASS,
  CASHIER_MODAL_CONTENT_CLASS,
  CASHIER_MODAL_OVERLAY_CLASS,
  CASHIER_MODAL_SCROLL_CLASS,
} from "@/components/cashier/modal-styles";
import { TransactionDetail, TransactionsTable } from "@/components/transactions/TransactionParts";
import { TransactionEditor, type EditorValue } from "@/components/transactions/TransactionEditor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";
import { usePaginatedItems } from "@/hooks/use-pagination";
import { cashierLimitStatusMessage, cashierTransactionActionAccess } from "@/lib/cashier";
import { RESERVING_STATUSES } from "@/lib/credit";
import { q } from "@/lib/queries";
import { transactionsService } from "@/services/transactions.service";
import { USE_DEMO_BACKEND } from "@/services/config";
import { readSession } from "@/services/session";
import type { CreditTransaction, TransactionStatus } from "@/types";

export type CashierPendingTab = "all" | "guest" | "disputed" | "price" | "finance";

const TABS: { id: CashierPendingTab; label: string; status: TransactionStatus[]; empty: string }[] =
  [
    {
      id: "all",
      label: "All",
      status: RESERVING_STATUSES,
      empty: "No pending or disputed transactions.",
    },
    {
      id: "guest",
      label: "Awaiting guest",
      status: ["pending_guest"],
      empty: "No transactions are waiting for guest confirmation.",
    },
    { id: "disputed", label: "Disputed", status: ["disputed"], empty: "No disputed transactions." },
    {
      id: "price",
      label: "Price approval",
      status: ["pending_price_approval"],
      empty: "No special-price requests are waiting.",
    },
    {
      id: "finance",
      label: "Awaiting Finance",
      status: ["pending_finance", "pending_exception"],
      empty: "Nothing is waiting for Finance.",
    },
  ];

export function CashierNewTransactionContent({
  initialGuestId,
  onSuccess,
  compact = false,
}: {
  initialGuestId?: string | undefined;
  onSuccess?: ((tx: CreditTransaction) => void) | undefined;
  compact?: boolean;
}) {
  const { data: accounts } = useSuspenseQuery(q.guestAccounts());
  const [guestId, setGuestId] = useState(initialGuestId ?? "");
  const account = accounts.find((guest) => guest.id === guestId);
  const eligible = account?.status === "active";
  const create = useAction(
    (value: EditorValue) => transactionsService.create({ ...value, guestId }),
    {
      success: cashierLimitStatusMessage,
      ...(onSuccess ? { onSuccess } : {}),
    },
  );

  return (
    <div className={compact ? "space-y-3" : "space-y-6"}>
      <Panel className={compact ? "p-3 sm:p-4" : undefined}>
        <SectionTitle title="1. Guest" compact={compact} />
        <GuestPicker value={guestId} compact={compact} onChange={(guest) => setGuestId(guest.id)} />
      </Panel>
      <Panel delay={60} className={compact ? "p-3 sm:p-4" : undefined}>
        <SectionTitle title="2. Services" compact={compact} />
        {!eligible && (
          <p className="mb-4 text-sm text-muted-foreground">Choose an active guest first.</p>
        )}
        <TransactionEditor
          key={guestId}
          compact={compact}
          disabled={!eligible}
          pending={create.isPending}
          submitLabel="Send to guest"
          onSubmit={(value) => create.mutate(value)}
        />
      </Panel>
    </div>
  );
}

export function CashierHistoryContent({
  onSelect,
  initialStatus = "all",
  onlyMine = false,
}: {
  onSelect?: ((tx: CreditTransaction) => void) | undefined;
  initialStatus?: TransactionStatus | "all";
  onlyMine?: boolean;
}) {
  const { data } = useSuspenseQuery(q.transactions());
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<TransactionStatus | "all">(initialStatus);
  const user = readSession()?.user;
  const term = search.trim().toLowerCase();
  const scopedRows = onlyMine
    ? data.filter((tx) => tx.createdBy === user?.fullName || tx.createdBy === user?.username)
    : data;
  const rows = scopedRows.filter(
    (tx) =>
      (status === "all" || tx.status === status) &&
      (!term || `${tx.code} ${tx.guestName}`.toLowerCase().includes(term)),
  );
  const pagination = usePaginatedItems(rows, `${status}:${term}`);

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search by code or guest name"
          className="max-w-sm flex-1"
        />
        <Select
          value={status}
          onValueChange={(value) => setStatus(value as TransactionStatus | "all")}
        >
          <SelectTrigger className="w-full bg-surface sm:w-56" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {(Object.keys(TX_STATUS_LABEL) as TransactionStatus[]).map((currentStatus) => (
              <SelectItem key={currentStatus} value={currentStatus}>
                {TX_STATUS_LABEL[currentStatus]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <TransactionsTable
        rows={pagination.currentItems}
        {...(!onSelect ? { detailTo: "/cashier/transactions/$id" as const } : {})}
        onRowClick={onSelect}
      />
      <PaginationControls {...pagination} />
    </>
  );
}

export function CashierPendingContent({
  onSelect,
  initialTab = "all",
}: {
  onSelect?: ((tx: CreditTransaction) => void) | undefined;
  initialTab?: CashierPendingTab;
}) {
  const { data } = useSuspenseQuery(q.transactions({ status: RESERVING_STATUSES }));
  const [tab, setTab] = useState<CashierPendingTab>(initialTab);
  const current = TABS.find((item) => item.id === tab) ?? TABS[0]!;
  const rows = data.filter((tx) => current.status.includes(tx.status));

  return (
    <>
      <Tabs
        value={tab}
        onValueChange={(value) => {
          const nextTab = TABS.find((item) => item.id === value);
          if (nextTab) setTab(nextTab.id);
        }}
        className="mb-4"
      >
        <TabsList className="h-auto flex-wrap">
          {TABS.map((item) => {
            const count = data.filter((tx) => item.status.includes(tx.status)).length;
            return (
              <TabsTrigger key={item.id} value={item.id} className="gap-2">
                {item.label}
                <Badge variant={item.id === "disputed" && count ? "danger" : "muted"}>
                  {count}
                </Badge>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>
      <TransactionsTable
        rows={rows}
        {...(!onSelect ? { detailTo: "/cashier/transactions/$id" as const } : {})}
        onRowClick={onSelect}
        empty={current.empty}
      />
    </>
  );
}

export function CashierTransactionDetailDialog({
  transactionId,
  onClose,
  nested = false,
}: {
  transactionId: string;
  onClose: () => void;
  nested?: boolean;
}) {
  const overlayClassName = nested ? "z-[60] md:top-16 lg:left-72" : CASHIER_MODAL_OVERLAY_CLASS;
  const contentClassName = nested
    ? `z-[70] ${CASHIER_DETAIL_MODAL_CONTENT_CLASS}`
    : `z-50 ${CASHIER_DETAIL_MODAL_CONTENT_CLASS}`;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        overlayClassName={overlayClassName}
        scrollAreaClassName={CASHIER_MODAL_SCROLL_CLASS}
        className={contentClassName}
      >
        <Suspense fallback={<CashierWorkflowFallback label="Loading transaction details..." />}>
          <CashierTransactionDetailBody transactionId={transactionId} nested={nested} />
        </Suspense>
      </DialogContent>
    </Dialog>
  );
}

export function InHotelConfirm({
  tx,
  compact = false,
}: {
  tx: CreditTransaction;
  compact?: boolean;
}) {
  const [method, setMethod] = useState<"pin" | "otp">("pin");
  const [code, setCode] = useState("");
  const [otpInfo, setOtpInfo] = useState<string | null>(null);
  const sendOtp = useAction(() => transactionsService.sendOtp(tx.id), {
    success: (r) => `Code sent to ${r.sentTo}.`,
    onSuccess: (r) =>
      setOtpInfo(
        r.demoCode ? `Sent to ${r.sentTo}. Demo code: ${r.demoCode}` : `Sent to ${r.sentTo}.`,
      ),
  });
  const confirm = useAction(() => transactionsService.confirmInHotel(tx.id, method, code.trim()), {
    success: "Guest confirmation recorded.",
    onSuccess: () => setCode(""),
  });

  if (tx.status !== "pending_guest") return null;

  return (
    <Panel
      className={
        compact
          ? "min-w-0 border-primary/30 bg-gold-soft p-3 sm:p-4"
          : "min-w-0 border-primary/30 bg-gold-soft"
      }
    >
      <SectionTitle title="Confirm in hotel" compact={compact} />
      <p className="mb-3 text-sm text-muted-foreground">
        {USE_DEMO_BACKEND
          ? "If the guest is at the desk, confirm with their PIN. SMS is optional."
          : "Ask the guest to enter their confirmation PIN. SMS is not required."}
      </p>
      {USE_DEMO_BACKEND && (
        <Tabs
          value={method}
          onValueChange={(value) => {
            setMethod(value as "pin" | "otp");
            setCode("");
          }}
          className="mb-3 min-w-0"
        >
          <TabsList className="grid h-auto w-full min-w-0 grid-cols-2">
            <TabsTrigger value="pin" className="min-w-0 gap-1 px-2">
              <KeyRound className="h-3.5 w-3.5 shrink-0" /> Guest PIN
            </TabsTrigger>
            <TabsTrigger value="otp" className="min-w-0 gap-1 px-2">
              <MessageSquareText className="h-3.5 w-3.5 shrink-0" /> SMS code
            </TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      <form
        className="min-w-0 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (code.trim()) confirm.mutate(undefined);
        }}
      >
        {method === "otp" && (
          <div className="min-w-0 space-y-2">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => sendOtp.mutate(undefined)}
              disabled={sendOtp.isPending}
            >
              {sendOtp.isPending && <Spinner className="h-4 w-4 text-current" />}
              {otpInfo ? "Send a new code" : "Send code to guest's phone"}
            </Button>
            {otpInfo && <p className="break-words text-xs text-info">{otpInfo}</p>}
          </div>
        )}
        <div className="min-w-0 space-y-2">
          <Label htmlFor={`confirm-code-${tx.id}`}>
            {method === "pin" ? "Guest enters their PIN" : "One-time code"}
          </Label>
          <Input
            id={`confirm-code-${tx.id}`}
            type={method === "pin" ? "password" : "text"}
            inputMode="numeric"
            autoComplete="off"
            required
            value={code}
            onChange={(event) =>
              setCode(event.target.value.replace(/\D/g, "").slice(0, method === "pin" ? 12 : 6))
            }
            className="min-w-0 bg-background text-center text-base tracking-[0.25em] sm:text-lg sm:tracking-[0.4em]"
          />
        </div>
        <Button type="submit" className="w-full" disabled={!code.trim() || confirm.isPending}>
          {confirm.isPending && <Spinner className="h-4 w-4 text-current" />}
          Confirm for guest
        </Button>
      </form>
    </Panel>
  );
}

export function CashierTransactionActions({
  tx,
  compact = false,
  nested = false,
}: {
  tx: CreditTransaction;
  compact?: boolean;
  nested?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const cashier = readSession()?.user;
  const access = cashierTransactionActionAccess(tx, cashier, USE_DEMO_BACKEND);
  const isDraft = tx.status === "draft";
  const correct = useAction(
    (value: EditorValue) =>
      isDraft
        ? transactionsService.updateDraft(tx.id, value)
        : transactionsService.correct(tx.id, value),
    {
      success: isDraft ? "Draft updated." : cashierLimitStatusMessage,
      onSuccess: () => setEditing(false),
    },
  );
  const cancel = useAction((reason: string) => transactionsService.cancel(tx.id, reason), {
    success: "Transaction cancelled.",
    onSuccess: () => setCancelling(false),
  });

  if (!access.showSection) return null;

  const explanation = !access.isOwner
    ? "Only the cashier who recorded this transaction can correct or cancel it."
    : tx.status === "expired"
      ? access.canCancel
        ? "This transaction has expired and cannot be corrected, but it can be cancelled."
        : "This transaction expired and can no longer be corrected or cancelled."
      : null;

  return (
    <>
      <div className={compact ? "space-y-3" : "space-y-4"}>
        <Panel className={compact ? "p-3 sm:p-4" : undefined}>
          <SectionTitle title="Cashier actions" compact={compact} />
          {(access.canCorrect || access.canCancel) && (
            <div className="flex flex-col gap-2 sm:flex-row">
              {access.canCorrect && (
                <Button
                  size={compact ? "sm" : "default"}
                  variant="gold"
                  className="flex-1"
                  onClick={() => setEditing((value) => !value)}
                >
                  <Pencil className="h-4 w-4" />
                  {editing ? "Close correction" : "Correct transaction"}
                </Button>
              )}
              {access.canCancel && (
                <Button
                  size={compact ? "sm" : "default"}
                  variant="outline"
                  className="flex-1"
                  onClick={() => setCancelling(true)}
                >
                  <XCircle className="h-4 w-4" /> Cancel transaction
                </Button>
              )}
            </div>
          )}
          {explanation && <p className="text-sm text-muted-foreground">{explanation}</p>}
        </Panel>
        {editing && access.canCorrect && (
          <Panel className={compact ? "p-3 sm:p-4" : undefined}>
            <SectionTitle
              title={isDraft ? "Edit draft" : "Correct and resubmit"}
              compact={compact}
            />
            <TransactionEditor
              key={`${tx.id}:${tx.revision}`}
              initialItems={tx.items}
              initialDate={tx.consumptionDate}
              requireNote={!isDraft}
              compact={compact}
              pending={correct.isPending}
              submitLabel={isDraft ? "Save draft" : "Save correction & resend"}
              onSubmit={(value) => correct.mutate(value)}
            />
          </Panel>
        )}
      </div>
      <ReasonDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={`Cancel ${tx.code}?`}
        description="The transaction will be cancelled, its credit reservation released, and any pending special-price request withdrawn."
        confirmLabel="Cancel transaction"
        confirmVariant="destructive"
        pending={cancel.isPending}
        nested={nested}
        onSubmit={(reason) => cancel.mutate(reason)}
      />
    </>
  );
}

function CashierTransactionDetailBody({
  transactionId,
  nested,
}: {
  transactionId: string;
  nested: boolean;
}) {
  const { data } = useSuspenseQuery(q.transaction(transactionId));
  return (
    <>
      <DialogHeader className="sticky top-0 z-10 bg-background/95 pb-2 pr-10 backdrop-blur">
        <DialogTitle className="font-display text-xl">Transaction details</DialogTitle>
        <DialogDescription>
          Full transaction information, limit status, and audit history.
        </DialogDescription>
      </DialogHeader>
      <TransactionDetail
        tx={data.transaction}
        aside={
          <>
            {data.transaction.status === "pending_guest" && (
              <InHotelConfirm tx={data.transaction} compact />
            )}
            <CashierTransactionActions tx={data.transaction} compact nested={nested} />
          </>
        }
        showCreditAmounts={false}
        compact
      />
    </>
  );
}

export function CashierTransactionDetails({
  transactionId,
  onClose,
  nested = false,
}: {
  transactionId: string | null;
  onClose: () => void;
  nested?: boolean;
}) {
  if (!transactionId) return null;
  return (
    <CashierTransactionDetailDialog
      transactionId={transactionId}
      onClose={onClose}
      nested={nested}
    />
  );
}

export function CashierWorkflowFallback({ label = "Loading..." }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
      <Spinner className="h-4 w-4" /> {label}
    </div>
  );
}
