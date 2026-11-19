import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Banknote, Download, Landmark } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { FormDialog, TextField } from "@/components/common/FormDialog";
import { GuestPicker } from "@/components/common/GuestPicker";
import { Field, Panel, TableShell } from "@/components/common/Panel";
import { EmptyState, Spinner } from "@/components/common/States";
import { PaginationControls } from "@/components/common/PaginationControls";
import { SearchInput } from "@/components/common/SearchInput";
import {
  PORTAL_MODAL_CONTENT_CLASS,
  PORTAL_MODAL_OVERLAY_CLASS,
  PORTAL_MODAL_SCROLL_CLASS,
} from "@/components/common/modal-styles";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePaginatedItems } from "@/hooks/use-pagination";
import { useAction } from "@/hooks/use-action";
import { date, dateTime, money } from "@/lib/format";
import { q } from "@/lib/queries";
import { errorMessage } from "@/services/http";
import { USE_DEMO_BACKEND } from "@/services/config";
import { paymentsService } from "@/services/finance.service";
import type { GuestAccount, Payment, PaymentMethod } from "@/types";

export function PaymentMethodBadge({ method }: { method: Payment["method"] }) {
  return (
    <Badge variant={method === "cash" ? "gold" : "info"}>
      {method === "cash" ? "Cash" : "Bank transfer"}
    </Badge>
  );
}

export function FinanceRecordPaymentDialog({ onClose }: { onClose: () => void }) {
  const [guestId, setGuestId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [bankName, setBankName] = useState("");
  const [reference, setReference] = useState("");
  const [paidAt, setPaidAt] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });
  const [verified, setVerified] = useState(true);
  const [note, setNote] = useState("");
  const record = useAction(
    () =>
      paymentsService.record({
        guestId,
        amount: Number(amount),
        method,
        paidAt: new Date(`${paidAt}T12:00:00`).toISOString(),
        verified,
        ...(method === "bank_transfer"
          ? {
              ...(bankName.trim() ? { bankName: bankName.trim() } : {}),
              reference: reference.trim(),
            }
          : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    {
      success: (payment) => `Payment recorded · receipt ${payment.receiptNumber}`,
      onSuccess: onClose,
    },
  );

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Record payment"
      description="Record a guest's cash or bank transfer payment."
      submitLabel="Record payment"
      pending={record.isPending}
      onSubmit={() => record.mutate(undefined)}
    >
      <div className="space-y-2">
        <Label>Guest</Label>
        <GuestPicker value={guestId} includeInactive onChange={(guest) => setGuestId(guest.id)} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField id="dashboard-payment-amount" label="Amount (ETB)" type="number" required value={amount} onChange={setAmount} inputMode="decimal" />
        <TextField id="dashboard-payment-date" label="Payment date" type="date" required value={paidAt} onChange={setPaidAt} />
      </div>
      <div className="space-y-2">
        <Label>Method</Label>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["cash", "Cash", Banknote],
              ["bank_transfer", "Bank transfer", Landmark],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setMethod(id)}
              aria-pressed={method === id}
              className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                method === id
                  ? "border-primary bg-primary/10 text-primary"
                  : "hover:border-primary/40"
              }`}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
      </div>
      {method === "bank_transfer" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {USE_DEMO_BACKEND && <TextField id="dashboard-payment-bank" label="Bank" value={bankName} onChange={setBankName} placeholder="Bank name" />}
          <TextField id="dashboard-payment-reference" label="Bank reference number" required value={reference} onChange={setReference} />
        </div>
      )}
      <label className="flex items-center justify-between gap-4 rounded-lg border bg-surface p-3">
        <span>
          <span className="block text-sm font-medium">Money received and verified</span>
          <span className="block text-xs text-muted-foreground">
            Unverified transfers can be reviewed later in Payment History.
          </span>
        </span>
        <Switch checked={verified} onCheckedChange={setVerified} />
      </label>
      {USE_DEMO_BACKEND && (
        <div className="space-y-2">
          <Label htmlFor="dashboard-payment-note">Note</Label>
          <Textarea id="dashboard-payment-note" rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional" />
        </div>
      )}
    </FormDialog>
  );
}

export function ReceiptButton({
  payment,
  guestPhone,
  label = "Receipt",
  variant = "outline",
  size = "sm",
}: {
  payment: Payment;
  guestPhone?: string | undefined;
  label?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant={variant}
      size={size}
      disabled={busy || !payment.verified}
      title={
        payment.verified
          ? "Download PDF receipt"
          : "Receipts are issued after the payment is verified"
      }
      onClick={async () => {
        setBusy(true);
        try {
          if (!USE_DEMO_BACKEND) {
            await paymentsService.downloadReceipt(payment.id);
            return;
          }
          const settings = await qc.fetchQuery(q.settings());
          let phone = guestPhone;
          if (!phone) {
            const accounts = await qc.fetchQuery(q.guestAccounts()).catch(() => []);
            phone = accounts.find((a) => a.id === payment.guestId)?.phone;
          }
          const { downloadReceiptPdf } = await import("@/lib/pdf");
          await downloadReceiptPdf(payment, { guestPhone: phone, settings });
        } catch (e) {
          toast.error(errorMessage(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Spinner className="h-4 w-4 text-current" /> : <Download className="h-4 w-4" />}{" "}
      {label}
    </Button>
  );
}

export function PaymentsTable({
  rows,
  showGuest = true,
  guestPhone,
  actions,
  onRowClick,
}: {
  rows: Payment[];
  showGuest?: boolean;
  guestPhone?: string | undefined;
  actions?: (p: Payment) => ReactNode;
  onRowClick?: ((payment: Payment) => void) | undefined;
}) {
  if (!rows.length)
    return (
      <EmptyState
        title="No payments yet"
        description="Payments recorded by the Finance Manager appear here."
      />
    );
  return (
    <TableShell>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Receipt no.</TableHead>
            {showGuest && <TableHead>Guest</TableHead>}
            <TableHead>Method</TableHead>
            <TableHead>Reference</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Remaining balance</TableHead>
            <TableHead>Recorded by</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Receipt</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((p) => (
            <TableRow
              key={p.id}
              className={
                onRowClick
                  ? "cursor-pointer transition-colors hover:bg-muted/60 focus-visible:bg-muted/60"
                  : undefined
              }
              tabIndex={onRowClick ? 0 : undefined}
              aria-label={onRowClick ? `View payment ${p.receiptNumber}` : undefined}
              onClick={
                onRowClick
                  ? (event) => {
                      if (
                        event.target instanceof Element &&
                        event.target.closest("button, a, input, select, textarea")
                      ) {
                        return;
                      }
                      onRowClick(p);
                    }
                  : undefined
              }
              onKeyDown={
                onRowClick
                  ? (event) => {
                      if (
                        event.target instanceof Element &&
                        event.target.closest("button, a, input, select, textarea")
                      ) {
                        return;
                      }
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onRowClick(p);
                      }
                    }
                  : undefined
              }
            >
              <TableCell className="whitespace-nowrap">{date(p.paidAt)}</TableCell>
              <TableCell className="whitespace-nowrap font-mono text-xs">
                {p.receiptNumber}
              </TableCell>
              {showGuest && <TableCell className="whitespace-nowrap">{p.guestName}</TableCell>}
              <TableCell>
                <PaymentMethodBadge method={p.method} />
              </TableCell>
              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                {p.reference ?? "—"}
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">
                {money(p.amount)}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {p.verified ? money(p.balanceAfter) : "—"}
              </TableCell>
              <TableCell className="whitespace-nowrap text-sm">{p.recordedBy}</TableCell>
              <TableCell>
                {p.verified ? (
                  <Badge variant="success">Verified</Badge>
                ) : (
                  <Badge variant="warning">Awaiting verification</Badge>
                )}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  {actions?.(p)}
                  <ReceiptButton payment={p} guestPhone={guestPhone} label="PDF" />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableShell>
  );
}

export function PaymentHistoryContent({ onSelect }: { onSelect: (payment: Payment) => void }) {
  const { data } = useSuspenseQuery(q.payments());
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  const rows = data.filter((payment) =>
    `${payment.guestName} ${payment.receiptNumber} ${payment.reference ?? ""}`
      .toLowerCase()
      .includes(term),
  );
  const pagination = usePaginatedItems(rows, term);
  const verifiedTotal = rows
    .filter((payment) => payment.verified)
    .reduce((sum, payment) => sum + payment.amount, 0);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search guest or receipt"
          className="max-w-sm flex-1"
        />
        <p className="text-xs text-muted-foreground">
          {rows.length} payments · {money(verifiedTotal)} verified
        </p>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No payments found." />
      ) : (
        <TableShell>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Guest</TableHead>
                <TableHead>Receipt no.</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagination.currentItems.map((payment) => (
                <TableRow
                  key={payment.id}
                  className="cursor-pointer transition-colors hover:bg-muted/60 focus-visible:bg-muted/60"
                  tabIndex={0}
                  aria-label={`View payment ${payment.receiptNumber} for ${payment.guestName}`}
                  onClick={() => onSelect(payment)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(payment);
                    }
                  }}
                >
                  <TableCell className="font-medium">{payment.guestName}</TableCell>
                  <TableCell className="font-mono text-xs">{payment.receiptNumber}</TableCell>
                  <TableCell className="text-right font-semibold text-success tabular-nums">
                    {money(payment.amount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableShell>
      )}
      <PaginationControls {...pagination} />
    </>
  );
}

export function PaymentDetailDialog({
  payment,
  onClose,
  nested = false,
  deep = false,
}: {
  payment: Payment | null;
  onClose: () => void;
  nested?: boolean;
  deep?: boolean;
}) {
  if (!payment) return null;

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
          <DialogTitle className="font-display text-xl">
            Payment {payment.receiptNumber}
          </DialogTitle>
          <DialogDescription>Full payment and receipt information.</DialogDescription>
        </DialogHeader>
        <Panel className="grid gap-3 p-3 sm:grid-cols-2 sm:p-4">
          <Field label="Guest" value={payment.guestName} />
          <Field
            label="Amount"
            value={<span className="font-semibold">{money(payment.amount)}</span>}
          />
          <Field label="Payment date" value={dateTime(payment.paidAt)} />
          <Field label="Method" value={<PaymentMethodBadge method={payment.method} />} />
          {payment.bankName && <Field label="Bank" value={payment.bankName} />}
          <Field label="Bank reference" value={payment.reference ?? "—"} />
          <Field label="Recorded by" value={payment.recordedBy} />
          <Field
            label="Status"
            value={
              payment.verified ? (
                <Badge variant="success">Verified</Badge>
              ) : (
                <Badge variant="warning">Awaiting verification</Badge>
              )
            }
          />
          <Field label="Balance before" value={money(payment.balanceBefore)} />
          <Field
            label="Remaining balance"
            value={payment.verified ? money(payment.balanceAfter) : "Pending verification"}
          />
          {payment.note && <Field label="Note" value={payment.note} />}
        </Panel>
        <div className="flex justify-end">
          <ReceiptButton payment={payment} label="Download PDF receipt" variant="default" />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function RecordPaymentDialog({
  account,
  onClose,
  nested = false,
  deep = false,
}: {
  account: GuestAccount;
  onClose: () => void;
  nested?: boolean;
  deep?: boolean;
}) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [bankName, setBankName] = useState("");
  const [reference, setReference] = useState("");
  const [paidAt, setPaidAt] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });
  const [verified, setVerified] = useState(true);
  const record = useAction(
    () =>
      paymentsService.record({
        guestId: account.id,
        amount: Number(amount),
        method,
        paidAt: new Date(`${paidAt}T12:00:00`).toISOString(),
        verified,
        ...(method === "bank_transfer"
          ? {
              ...(bankName.trim() ? { bankName: bankName.trim() } : {}),
              reference: reference.trim(),
            }
          : {}),
      }),
    {
      success: (payment) => `Payment recorded · receipt ${payment.receiptNumber}`,
      onSuccess: onClose,
    },
  );

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Record payment · ${account.fullName}`}
      description="Verified payments reduce the guest's outstanding debt immediately."
      submitLabel="Record payment"
      pending={record.isPending}
      nested={nested}
      deep={deep}
      onSubmit={() => record.mutate(undefined)}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          id="guest-payment-amount"
          label="Amount (ETB)"
          type="number"
          required
          value={amount}
          onChange={setAmount}
          inputMode="decimal"
        />
        <TextField
          id="guest-payment-date"
          label="Payment date"
          type="date"
          required
          value={paidAt}
          onChange={setPaidAt}
        />
      </div>
      <div className="space-y-2">
        <Label>Method</Label>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["cash", "Cash", Banknote],
              ["bank_transfer", "Bank transfer", Landmark],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setMethod(id)}
              aria-pressed={method === id}
              className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                method === id
                  ? "border-primary bg-primary/10 text-primary"
                  : "hover:border-primary/40"
              }`}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
      </div>
      {method === "bank_transfer" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {USE_DEMO_BACKEND && (
            <TextField
              id="guest-payment-bank"
              label="Bank"
              value={bankName}
              onChange={setBankName}
              placeholder="Bank name"
            />
          )}
          <TextField
            id="guest-payment-reference"
            label="Bank reference number"
            required
            value={reference}
            onChange={setReference}
          />
        </div>
      )}
      <label className="flex items-center justify-between gap-4 rounded-lg border bg-surface p-3">
        <span>
          <span className="block text-sm font-medium">Money received and verified</span>
          <span className="block text-xs text-muted-foreground">
            Unverified transfers can be verified later from Payment History.
          </span>
        </span>
        <Switch checked={verified} onCheckedChange={setVerified} />
      </label>
    </FormDialog>
  );
}
