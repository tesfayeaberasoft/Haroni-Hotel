import { useSuspenseQuery } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useState } from "react";
import {
  PORTAL_MODAL_CONTENT_CLASS,
  PORTAL_MODAL_OVERLAY_CLASS,
  PORTAL_MODAL_SCROLL_CLASS,
} from "@/components/common/modal-styles";
import { FormDialog, TextField } from "@/components/common/FormDialog";
import { GuestPicker } from "@/components/common/GuestPicker";
import { Field, Panel, TableShell } from "@/components/common/Panel";
import { EmptyState, Spinner } from "@/components/common/States";
import { HistoricalStatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAction } from "@/hooks/use-action";
import { date, dateTime, money } from "@/lib/format";
import { q } from "@/lib/queries";
import { historicalService } from "@/services/finance.service";
import type { HistoricalDebt } from "@/types";

export function HistoricalRecordsContent({
  pendingOnly = true,
  nested = false,
}: {
  pendingOnly?: boolean;
  nested?: boolean;
}) {
  const { data } = useSuspenseQuery(q.historical());
  const [selectedRecord, setSelectedRecord] = useState<HistoricalDebt | null>(null);
  const rows = pendingOnly
    ? data.filter((record) => record.status === "pending_verification")
    : data;

  if (!rows.length) {
    return (
      <EmptyState
        title={
          pendingOnly ? "No historical records await verification." : "No historical records yet."
        }
      />
    );
  }

  return (
    <TableShell>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-1/4">Guest</TableHead>
            <TableHead className="w-2/5">Source reference</TableHead>
            <TableHead className="w-[18%] text-right">Amount</TableHead>
            <TableHead className="w-[17%]">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((record) => (
            <HistoricalRecordRow
              key={record.id}
              record={record}
              onSelect={() => setSelectedRecord(record)}
            />
          ))}
        </TableBody>
      </Table>
      <HistoricalRecordDetailDialog
        record={selectedRecord}
        nested={nested}
        onClose={() => setSelectedRecord(null)}
      />
    </TableShell>
  );
}

function HistoricalRecordRow({
  record,
  onSelect,
}: {
  record: HistoricalDebt;
  onSelect: () => void;
}) {
  return (
    <TableRow
      className="cursor-pointer transition-colors hover:bg-muted/60 focus-visible:bg-muted/60"
      tabIndex={0}
      aria-label={`View historical debt record for ${record.guestName}`}
      onClick={(event) => {
        if (event.target instanceof Element && event.target.closest("button")) return;
        onSelect();
      }}
      onKeyDown={(event) => {
        if (event.target instanceof Element && event.target.closest("button")) {
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <TableCell className="whitespace-nowrap font-medium">{record.guestName}</TableCell>
      <TableCell className="text-sm">
        {record.sourceReference}
        {record.evidenceNote && (
          <div className="text-xs text-muted-foreground">{record.evidenceNote}</div>
        )}
      </TableCell>
      <TableCell className="text-right font-semibold tabular-nums">
        {money(record.amount)}
      </TableCell>
      <TableCell>
        <HistoricalStatusBadge status={record.status} />
        {record.verifiedBy && (
          <div className="mt-1 text-xs text-muted-foreground">{record.verifiedBy}</div>
        )}
      </TableCell>
    </TableRow>
  );
}

export function HistoricalRecordDetailDialog({
  record,
  onClose,
  nested = false,
}: {
  record: HistoricalDebt | null;
  onClose: () => void;
  nested?: boolean;
}) {
  if (!record) return null;
  return (
    <HistoricalRecordDetailBody key={record.id} record={record} onClose={onClose} nested={nested} />
  );
}

function HistoricalRecordDetailBody({
  record,
  onClose,
  nested,
}: {
  record: HistoricalDebt;
  onClose: () => void;
  nested: boolean;
}) {
  const approve = useAction(() => historicalService.approve(record.id), {
    success: `Opening balance verified for ${record.guestName}.`,
    onSuccess: onClose,
  });
  const reject = useAction(() => historicalService.reject(record.id), {
    success: "Record rejected.",
    onSuccess: onClose,
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        overlayClassName={nested ? "z-[60] md:top-16 lg:left-72" : PORTAL_MODAL_OVERLAY_CLASS}
        scrollAreaClassName={PORTAL_MODAL_SCROLL_CLASS}
        className={`${PORTAL_MODAL_CONTENT_CLASS} ${nested ? "z-[70]" : ""}`}
      >
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            Historical record · {record.guestName}
          </DialogTitle>
          <DialogDescription>Full opening-balance record details.</DialogDescription>
        </DialogHeader>
        <Panel className="grid gap-3 p-3 sm:grid-cols-2 sm:p-4">
          <Field label="Guest" value={record.guestName} />
          <Field label="Amount" value={money(record.amount)} />
          <Field label="Source reference" value={record.sourceReference} />
          <Field label="Original date" value={date(record.originalDate)} />
          <Field label="Evidence note" value={record.evidenceNote ?? "—"} />
          <Field label="Status" value={<HistoricalStatusBadge status={record.status} />} />
          <Field label="Entered by" value={record.enteredBy} />
          <Field label="Entered at" value={dateTime(record.enteredAt)} />
          <Field label="Verified by" value={record.verifiedBy ?? "—"} />
          <Field
            label="Verified at"
            value={record.verifiedAt ? dateTime(record.verifiedAt) : "—"}
          />
        </Panel>
        {record.status === "pending_verification" && (
          <DialogFooter>
            <Button
              size="sm"
              variant="outline"
              onClick={() => reject.mutate(undefined)}
              disabled={approve.isPending || reject.isPending}
            >
              {reject.isPending && <Spinner className="h-4 w-4 text-current" />}
              <X className="h-4 w-4" /> Reject
            </Button>
            <Button
              size="sm"
              variant="success"
              onClick={() => approve.mutate(undefined)}
              disabled={approve.isPending || reject.isPending}
            >
              {approve.isPending && <Spinner className="h-4 w-4 text-current" />}
              <Check className="h-4 w-4" /> Verify
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function HistoricalRecordDialog({
  onClose,
  initialGuestId = "",
  nested = false,
  deep = false,
}: {
  onClose: () => void;
  initialGuestId?: string;
  nested?: boolean;
  deep?: boolean;
}) {
  const [guestId, setGuestId] = useState(initialGuestId);
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [originalDate, setOriginalDate] = useState("");
  const save = useAction(
    () =>
      historicalService.create({
        guestId,
        amount: Number(amount),
        sourceReference: reference.trim(),
        originalDate: originalDate
          ? new Date(`${originalDate}T12:00:00`).toISOString()
          : new Date().toISOString(),
        ...(note.trim() ? { evidenceNote: note.trim() } : {}),
      }),
    { success: "Record added for verification.", onSuccess: onClose },
  );

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Add historical record"
      description="It counts towards the guest's debt only after verification."
      submitLabel="Add record"
      pending={save.isPending}
      nested={nested}
      deep={deep}
      onSubmit={() => save.mutate(undefined)}
    >
      <div className="space-y-2">
        <Label>Guest</Label>
        <GuestPicker value={guestId} onChange={(guest) => setGuestId(guest.id)} includeInactive />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          id="finance-historical-amount"
          label="Amount (ETB)"
          type="number"
          required
          value={amount}
          onChange={setAmount}
        />
        <TextField
          id="finance-historical-date"
          label="Original date"
          type="date"
          value={originalDate}
          onChange={setOriginalDate}
        />
      </div>
      <TextField
        id="finance-historical-reference"
        label="Source reference"
        required
        value={reference}
        onChange={setReference}
        placeholder="Ledger book, page, slip number"
      />
      <TextField
        id="finance-historical-note"
        label="Evidence note"
        value={note}
        onChange={setNote}
        placeholder="Optional"
      />
    </FormDialog>
  );
}
