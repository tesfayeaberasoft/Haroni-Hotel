import { useQuery } from "@tanstack/react-query";
import { Lock, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Spinner } from "@/components/common/States";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { lineTotal, roundMoney } from "@/lib/credit";
import { money } from "@/lib/format";
import { q } from "@/lib/queries";
import { cn } from "@/lib/utils";
import type { TransactionLineInput } from "@/services/transactions.service";
import type { HotelService, ServiceCategory, TransactionItem } from "@/types";

interface Line {
  key: number;
  serviceId: string;
  quantity: string;
  special: boolean;
  requestedPrice: string;
  priceReason: string;
}

const CATS: { id: ServiceCategory; label: string }[] = [
  { id: "food", label: "Food" },
  { id: "drinks", label: "Drinks" },
  { id: "accommodation", label: "Accommodation" },
  { id: "other", label: "Other services" },
];

let seq = 1;
const blank = (): Line => ({
  key: seq++,
  serviceId: "",
  quantity: "1",
  special: false,
  requestedPrice: "",
  priceReason: "",
});

export interface EditorValue {
  consumptionDate: string;
  items: TransactionLineInput[];
  note?: string | undefined;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Service lines with catalog-locked prices. A different price can only be requested
 * (with a reason) and needs Finance Manager approval before the guest sees the transaction.
 */
export function TransactionEditor({
  initialItems,
  initialDate,
  submitLabel,
  pending,
  requireNote = false,
  disabled = false,
  compact = false,
  onSubmit,
}: {
  initialItems?: TransactionItem[] | undefined;
  initialDate?: string | undefined;
  submitLabel: string;
  pending?: boolean;
  requireNote?: boolean;
  disabled?: boolean;
  compact?: boolean;
  onSubmit: (v: EditorValue) => void;
}) {
  const { data: services = [] } = useQuery(q.services());
  const [date, setDate] = useState(initialDate ? initialDate.slice(0, 10) : today());
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>(() =>
    initialItems?.length
      ? initialItems.map((i) => ({
          key: seq++,
          serviceId: i.serviceId,
          quantity: String(i.quantity),
          special: Boolean(i.priceRequest && i.priceRequest.status !== "rejected"),
          requestedPrice: i.priceRequest ? String(i.priceRequest.requestedPrice) : "",
          priceReason: i.priceRequest?.reason ?? "",
        }))
      : [blank()],
  );

  const byId = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);
  const priced = lines.map((l) => {
    const svc = byId.get(l.serviceId);
    const qty = Number(l.quantity) || 0;
    const special = l.special && Number(l.requestedPrice) > 0 ? Number(l.requestedPrice) : null;
    const unit = special ?? svc?.price ?? 0;
    return { line: l, svc, qty, unit, total: lineTotal(qty, unit) };
  });
  const total = roundMoney(priced.reduce((a, p) => a + p.total, 0));
  const hasSpecial = priced.some((p) => p.line.special);

  const update = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: number) => {
    setError(null);
    setLines((current) => {
      if (current.length <= 1) {
        const onlyLine = current[0];
        return [
          onlyLine
            ? {
                ...onlyLine,
                serviceId: "",
                quantity: "1",
                special: false,
                requestedPrice: "",
                priceReason: "",
              }
            : blank(),
        ];
      }

      return current.filter((line) => line.key !== key);
    });
  };

  const submit = () => {
    setError(null);
    if (priced.some((p) => !p.svc)) return setError("Choose a service for every line.");
    if (priced.some((p) => !(p.qty > 0)))
      return setError("Every quantity must be greater than zero.");
    if (
      priced.some(
        (p) =>
          p.line.special &&
          (!(Number(p.line.requestedPrice) > 0) || p.line.priceReason.trim().length < 5),
      )
    )
      return setError("Special prices need a valid price and a reason (at least 5 characters).");
    if (
      priced.some((p) => p.line.special && p.svc && Number(p.line.requestedPrice) === p.svc.price)
    )
      return setError("The requested special price must differ from the catalog price.");
    if (requireNote && note.trim().length < 5)
      return setError("Describe the correction you made (at least 5 characters).");
    onSubmit({
      consumptionDate: new Date(`${date}T12:00:00`).toISOString(),
      note: note.trim() || undefined,
      items: priced.map((p) => ({
        serviceId: p.line.serviceId,
        quantity: p.qty,
        ...(p.line.special
          ? {
              requestedPrice: Number(p.line.requestedPrice),
              priceReason: p.line.priceReason.trim(),
            }
          : {}),
      })),
    });
  };

  return (
    <div
      className={cn(
        compact ? "space-y-3" : "space-y-6",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <div className={cn("grid sm:grid-cols-[220px_1fr]", compact ? "gap-2.5" : "gap-4")}>
        <div className={compact ? "space-y-1" : "space-y-2"}>
          <Label className={compact ? "text-xs" : undefined} htmlFor="consumption-date">
            Consumption date
          </Label>
          <Input
            id="consumption-date"
            type="date"
            value={date}
            max={today()}
            onChange={(e) => setDate(e.target.value)}
            className={cn(compact ? "h-9 text-sm" : "", "bg-surface")}
          />
        </div>
        <div className="flex items-end text-xs text-muted-foreground">
          <Lock className="mr-1.5 h-3.5 w-3.5 text-primary" /> Prices come from the service catalog
          and cannot be edited. Each consumption date is recorded as its own transaction.
        </div>
      </div>

      <div className={compact ? "space-y-2" : "space-y-3"}>
        {priced.map(({ line, svc, unit, total: lt }, idx) => {
          const serviceField = (
            <div className={cn("min-w-0", compact ? "space-y-1" : "space-y-1.5")}>
              <Label className="text-xs text-muted-foreground">Service {idx + 1}</Label>
              <Select
                value={line.serviceId}
                onValueChange={(v) => update(line.key, { serviceId: v })}
              >
                <SelectTrigger
                  className={cn(compact ? "h-9" : "h-10", "w-full min-w-0 bg-background")}
                  aria-label={`Service ${idx + 1}`}
                >
                  <SelectValue placeholder="Select a service" />
                </SelectTrigger>
                <SelectContent>
                  {CATS.map((c) => {
                    const list = services.filter(
                      (s: HotelService) => s.category === c.id && s.available,
                    );
                    if (!list.length) return null;
                    return (
                      <SelectGroup key={c.id}>
                        <SelectLabel className="text-primary">{c.label}</SelectLabel>
                        {list.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name} — {money(s.price)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          );
          const quantityField = (
            <div className={cn("min-w-0", compact ? "space-y-1" : "space-y-1.5")}>
              <Label className="text-xs text-muted-foreground">Quantity</Label>
              <Input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={line.quantity}
                onChange={(e) => update(line.key, { quantity: e.target.value })}
                className={cn(compact ? "h-9" : "h-10", "min-w-0 bg-background")}
                aria-label={`Quantity ${idx + 1}`}
              />
            </div>
          );
          const priceField = (
            <div className={cn("min-w-0", compact ? "space-y-1" : "space-y-1.5")}>
              <Label className="text-xs leading-tight text-muted-foreground">
                Unit price (catalog)
              </Label>
              <div
                className={cn(
                  compact
                    ? "min-h-9 gap-0.5 px-1 py-1 text-[11px] leading-tight"
                    : "h-10 gap-2 px-3 text-sm",
                  "flex min-w-0 items-center rounded-md border border-dashed bg-muted/40 tabular-nums text-muted-foreground",
                )}
              >
                <Lock className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 break-all">{svc ? money(svc.price) : "—"}</span>
              </div>
            </div>
          );
          const totalField = (
            <div className={cn("min-w-0", compact ? "space-y-1" : "space-y-1.5")}>
              <Label className="text-xs text-muted-foreground">Line total</Label>
              <div
                className={cn(
                  compact ? "min-h-9 py-1 text-sm leading-tight" : "h-10",
                  "flex min-w-0 items-center px-1 font-semibold tabular-nums",
                )}
              >
                <span className="min-w-0 break-all">{money(lt)}</span>
              </div>
            </div>
          );
          const removeButton = (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn("shrink-0", compact && "h-9 w-9")}
              onClick={() => removeLine(line.key)}
              aria-label={lines.length === 1 ? "Clear service row" : "Remove service row"}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          );

          return (
            <div
              key={line.key}
              className={cn("min-w-0 rounded-xl border bg-surface", compact ? "p-2.5" : "p-4")}
            >
              {compact ? (
                <>
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_2.25rem] items-end gap-2">
                    {serviceField}
                    {removeButton}
                  </div>
                  <div className="mt-2 grid min-w-0 grid-cols-3 gap-2">
                    {quantityField}
                    {priceField}
                    {totalField}
                  </div>
                </>
              ) : (
                <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_110px_150px_minmax(110px,150px)_40px] md:items-end">
                  {serviceField}
                  {quantityField}
                  {priceField}
                  {totalField}
                  {removeButton}
                </div>
              )}
              <div
                className={cn(
                  "flex flex-wrap items-center border-t border-dashed",
                  compact ? "mt-2 gap-2 pt-2" : "mt-3 gap-3 pt-3",
                )}
              >
                <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                  <Switch
                    checked={line.special}
                    onCheckedChange={(v) => update(line.key, { special: v })}
                    disabled={!svc}
                  />
                  Request a special price (needs Finance approval)
                </label>
                {line.special && (
                  <div
                    className={cn(
                      "grid w-full sm:grid-cols-[160px_1fr]",
                      compact ? "gap-2" : "gap-3",
                    )}
                  >
                    <Input
                      type="number"
                      min={1}
                      placeholder="Requested price"
                      value={line.requestedPrice}
                      onChange={(e) => update(line.key, { requestedPrice: e.target.value })}
                      className={cn(compact ? "h-9" : "", "bg-background")}
                    />
                    <Input
                      placeholder="Reason for the special price"
                      value={line.priceReason}
                      onChange={(e) => update(line.key, { priceReason: e.target.value })}
                      className={cn(compact ? "h-9" : "", "bg-background")}
                    />
                    {unit !== svc?.price && (
                      <div className="text-xs text-info sm:col-span-2">
                        Line will use {money(unit)} once Finance approves; otherwise the catalog
                        price applies.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <Button
          variant="gold"
          size={compact ? "sm" : "default"}
          onClick={() => setLines((ls) => [...ls, blank()])}
        >
          <Plus className="h-4 w-4" /> Add another service
        </Button>
      </div>

      {requireNote && (
        <div className="space-y-2">
          <Label htmlFor="correction-note">
            What did you correct? <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="correction-note"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Removed one Special Kitfo and the avocado juice as the guest reported."
          />
        </div>
      )}

      <div
        className={cn(
          "flex flex-col rounded-xl border border-primary/25 bg-gold-soft sm:flex-row sm:items-center sm:justify-between",
          compact ? "gap-2.5 p-3" : "gap-4 p-5",
        )}
      >
        <div>
          <div
            className={cn(
              "uppercase tracking-widest text-muted-foreground",
              compact ? "text-[11px]" : "text-xs",
            )}
          >
            Transaction total
          </div>
          <div
            className={cn(
              "font-display font-semibold text-primary tabular-nums",
              compact ? "text-xl" : "text-3xl",
            )}
          >
            {money(total)}
          </div>
          {hasSpecial && (
            <div className="mt-1 text-xs text-info">
              Includes a special price request — Finance approves it before the guest is asked to
              confirm.
            </div>
          )}
        </div>
        <Button
          size={compact ? "sm" : "lg"}
          onClick={submit}
          disabled={pending || disabled || total <= 0}
        >
          {pending && <Spinner className="h-4 w-4 text-current" />} {submitLabel}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
