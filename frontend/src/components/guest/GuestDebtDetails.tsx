import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useState, type KeyboardEvent } from "react";
import { CreditSummary } from "@/components/common/CreditSummary";
import {
  PORTAL_MODAL_CONTENT_CLASS,
  PORTAL_MODAL_SCROLL_CLASS,
} from "@/components/common/modal-styles";
import { PageHeader, SectionTitle } from "@/components/common/PageHeader";
import { Field, Panel, TableShell } from "@/components/common/Panel";
import { EmptyState, Spinner } from "@/components/common/States";
import { HistoricalStatusBadge, TxStatusBadge } from "@/components/common/StatusBadge";
import { PaymentMethodBadge, ReceiptButton } from "@/components/finance/PaymentParts";
import { ItemsTable, TransactionDetail } from "@/components/transactions/TransactionParts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { date, dateTime, money } from "@/lib/format";
import { q } from "@/lib/queries";
import { downloadStatementPdf } from "@/lib/pdf";
import { USE_DEMO_BACKEND } from "@/services/config";
import { errorMessage } from "@/services/http";
import { guestSelfService } from "@/services/finance.service";
import type { CreditTransaction, Payment } from "@/types";
import { toast } from "sonner";

export function GuestDebtDetails({ embedded = false }: { embedded?: boolean }) {
  const { data: statement } = useSuspenseQuery(q.myStatement());
  const { data: payments } = useSuspenseQuery(q.payments());
  const { data: settings } = useQuery({ ...q.settings(), enabled: USE_DEMO_BACKEND });
  const [busy, setBusy] = useState(false);
  const [selectedTransactionId, setSelectedTransactionId] = useState<string | null>(null);
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const transactionQuery = useQuery({
    ...q.transaction(selectedTransactionId ?? ""),
    enabled: selectedTransactionId !== null,
  });
  const approved = statement.transactions.filter(
    (transaction) => transaction.status === "approved",
  );

  const downloadStatement = async () => {
    setBusy(true);
    try {
      if (USE_DEMO_BACKEND) {
        if (!settings) throw new Error("System settings are unavailable. Try again.");
        await downloadStatementPdf({ ...statement, payments }, settings);
      } else {
        await guestSelfService.downloadStatement();
      }
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {!embedded && (
        <PageHeader
          eyebrow="Debt & payments"
          title="Debt details"
          description="How your outstanding balance is made up."
          actions={
            <Button onClick={() => void downloadStatement()} disabled={busy}>
              {busy ? <Spinner className="h-4 w-4 text-current" /> : null}
              Download statement (PDF)
            </Button>
          }
        />
      )}
      <Panel className={embedded ? "p-4 sm:p-4" : undefined}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionTitle title="Balance breakdown" compact={embedded} />
          {embedded && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void downloadStatement()}
              disabled={busy}
            >
              {busy ? <Spinner className="h-4 w-4 text-current" /> : null}
              Download statement
            </Button>
          )}
        </div>
        <dl className="divide-y text-sm">
          {[
            ["Opening balance (earlier records)", money(statement.account.historicalDebt)],
            ["Approved charges", money(statement.account.approvedCredit)],
            ["Payments received", `− ${money(statement.account.totalPayments)}`],
          ].map(([label, amount]) => (
            <div key={label} className={`flex justify-between gap-3 ${embedded ? "py-2" : "py-3"}`}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-medium tabular-nums">{amount}</dd>
            </div>
          ))}
          <div className={`flex justify-between gap-3 ${embedded ? "py-3" : "py-4"}`}>
            <dt className="font-semibold">Outstanding balance</dt>
            <dd
              className={`font-display ${embedded ? "text-xl" : "text-2xl"} font-semibold text-primary tabular-nums`}
            >
              {money(statement.account.outstandingDebt)}
            </dd>
          </div>
        </dl>
        {statement.account.pendingReservations > 0 && (
          <p className="text-xs text-muted-foreground">
            {money(statement.account.pendingReservations)} in charges still awaiting confirmation or
            approval is not included yet.
          </p>
        )}
      </Panel>
      <CreditSummary account={statement.account} className={embedded ? "mt-4" : "mt-6"} />
      {statement.historical.length > 0 && (
        <div className={embedded ? "mt-4" : "mt-8"}>
          <SectionTitle title="Opening balance records" compact={embedded} />
          <div className={embedded ? "space-y-2" : "space-y-3"}>
            {statement.historical.map((record) => (
              <Panel key={record.id} className={embedded ? "p-3 sm:p-3" : "p-4 sm:p-4"}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">{record.sourceReference}</div>
                    <div className="text-xs text-muted-foreground">
                      Original date {date(record.originalDate)}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <HistoricalStatusBadge status={record.status} />
                    <span className="font-semibold tabular-nums">{money(record.amount)}</span>
                  </div>
                </div>
              </Panel>
            ))}
          </div>
        </div>
      )}
      <div className={`grid grid-cols-1 lg:grid-cols-2 ${embedded ? "mt-4 gap-4" : "mt-8 gap-6"}`}>
        <Panel className={embedded ? "min-w-0 p-3 sm:p-4" : "min-w-0"}>
          <SectionTitle title="Approved charges" compact={embedded} />
          <CompactChargesTable rows={approved} onSelect={setSelectedTransactionId} />
        </Panel>
        <Panel className={embedded ? "min-w-0 p-3 sm:p-4" : "min-w-0"}>
          <SectionTitle title="Payments" compact={embedded} />
          <CompactPaymentsTable rows={payments} onSelect={setSelectedPayment} />
        </Panel>
      </div>

      <Dialog
        open={selectedTransactionId !== null}
        onOpenChange={(open) => !open && setSelectedTransactionId(null)}
      >
        <DialogContent
          overlayClassName="z-[60] md:top-16 lg:left-72"
          scrollAreaClassName={PORTAL_MODAL_SCROLL_CLASS}
          className={`z-[70] ${PORTAL_MODAL_CONTENT_CLASS}`}
        >
          <DialogHeader className="sticky top-0 z-10 bg-background/95 pb-2 pr-10 backdrop-blur">
            <DialogTitle className="font-display text-xl">Transaction details</DialogTitle>
            <DialogDescription>
              Services, confirmation, approval and audit history.
            </DialogDescription>
          </DialogHeader>
          {transactionQuery.isPending && (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" /> Loading transaction details...
            </div>
          )}
          {transactionQuery.isError && (
            <p role="alert" className="py-4 text-sm text-destructive">
              {errorMessage(transactionQuery.error)}
            </p>
          )}
          {transactionQuery.data && (
            <TransactionDetail
              tx={transactionQuery.data.transaction}
              creditSummary={<CreditSummary account={statement.account} compact />}
              compact
            />
          )}
        </DialogContent>
      </Dialog>

      <PaymentDetailDialog
        payment={selectedPayment}
        guestPhone={statement.account.phone}
        onOpenChange={(open) => !open && setSelectedPayment(null)}
      />
    </>
  );
}

function CompactChargesTable({
  rows,
  onSelect,
}: {
  rows: CreditTransaction[];
  onSelect: (id: string) => void;
}) {
  if (!rows.length) return <EmptyState title="No approved charges yet." />;
  const activateOnKey = (event: KeyboardEvent<HTMLTableRowElement>, id: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(id);
    }
  };

  return (
    <TableShell className="animate-none shadow-none">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Transaction</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((transaction) => (
            <TableRow
              key={transaction.id}
              role="button"
              tabIndex={0}
              aria-label={`View transaction ${transaction.code}`}
              className="cursor-pointer hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onSelect(transaction.id)}
              onKeyDown={(event) => activateOnKey(event, transaction.id)}
            >
              <TableCell className="font-semibold text-primary">{transaction.code}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">
                {money(transaction.total)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableShell>
  );
}

function CompactPaymentsTable({
  rows,
  onSelect,
}: {
  rows: Payment[];
  onSelect: (payment: Payment) => void;
}) {
  if (!rows.length)
    return (
      <EmptyState
        title="No payments yet"
        description="Payments recorded by the Finance Manager appear here."
      />
    );
  const activateOnKey = (event: KeyboardEvent<HTMLTableRowElement>, payment: Payment) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(payment);
    }
  };

  return (
    <TableShell className="animate-none shadow-none">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Receipt no.</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((payment) => (
            <TableRow
              key={payment.id}
              role="button"
              tabIndex={0}
              aria-label={`View payment receipt ${payment.receiptNumber}`}
              className="cursor-pointer hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onSelect(payment)}
              onKeyDown={(event) => activateOnKey(event, payment)}
            >
              <TableCell className="font-mono text-xs">{payment.receiptNumber}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">
                {money(payment.amount)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableShell>
  );
}

function PaymentDetailDialog({
  payment,
  guestPhone,
  onOpenChange,
}: {
  payment: Payment | null;
  guestPhone: string;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={payment !== null} onOpenChange={onOpenChange}>
      <DialogContent
        overlayClassName="z-[60] md:top-16 lg:left-72"
        scrollAreaClassName={PORTAL_MODAL_SCROLL_CLASS}
        className={`z-[70] ${PORTAL_MODAL_CONTENT_CLASS}`}
      >
        <DialogHeader className="sticky top-0 z-10 bg-background/95 pb-2 pr-10 backdrop-blur">
          <DialogTitle className="font-display text-xl">Payment details</DialogTitle>
          <DialogDescription>
            {payment ? `Receipt ${payment.receiptNumber}` : "Payment information and receipt."}
          </DialogDescription>
        </DialogHeader>
        {payment && (
          <div className="space-y-3">
            <Panel className="p-4 sm:p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">
                    Amount received
                  </div>
                  <div className="font-display text-2xl font-semibold text-primary">
                    {money(payment.amount)}
                  </div>
                </div>
                {payment.verified ? (
                  <Badge variant="success">Verified</Badge>
                ) : (
                  <Badge variant="warning">Awaiting verification</Badge>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Receipt no." value={payment.receiptNumber} />
                <Field label="Payment date" value={dateTime(payment.paidAt)} />
                <Field label="Method" value={<PaymentMethodBadge method={payment.method} />} />
                {payment.method === "bank_transfer" && (
                  <>
                    <Field label="Bank reference" value={payment.reference || "—"} />
                    <Field label="Bank" value={payment.bankName || "—"} />
                  </>
                )}
                <Field label="Previous balance" value={money(payment.balanceBefore)} />
                <Field
                  label="Remaining balance"
                  value={payment.verified ? money(payment.balanceAfter) : "—"}
                />
                <Field label="Recorded by" value={payment.recordedBy} />
              </div>
              {payment.note && <p className="mt-3 text-sm text-muted-foreground">{payment.note}</p>}
              <div className="mt-4">
                <ReceiptButton
                  payment={payment}
                  guestPhone={guestPhone}
                  label="Download PDF receipt"
                  variant="gold"
                  size="sm"
                />
              </div>
            </Panel>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
