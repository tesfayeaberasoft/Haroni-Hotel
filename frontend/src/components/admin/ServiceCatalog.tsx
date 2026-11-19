import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { FormDialog, TextField } from "@/components/common/FormDialog";
import { PageHeader, SectionTitle } from "@/components/common/PageHeader";
import { Field, Panel } from "@/components/common/Panel";
import { SearchInput } from "@/components/common/SearchInput";
import { EmptyState } from "@/components/common/States";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAction } from "@/hooks/use-action";
import { useAuth } from "@/hooks/use-auth";
import { dateTime, money } from "@/lib/format";
import { q } from "@/lib/queries";
import { catalogService } from "@/services/catalog.service";
import type { HotelService, ServiceCategory } from "@/types";

const CATS: { id: ServiceCategory; label: string }[] = [
  { id: "food", label: "Food" },
  { id: "drinks", label: "Drinks" },
  { id: "accommodation", label: "Accommodation" },
  { id: "other", label: "Other services" },
];

export function ServicesPage({ embedded = false }: { embedded?: boolean }) {
  const { session } = useAuth();
  const isFinanceManager = session?.user.role === "finance" || session?.user.role === "owner";
  const { data } = useSuspenseQuery(q.services());
  const [editing, setEditing] = useState<HotelService | "new" | null>(null);
  const [search, setSearch] = useState("");
  const list = data.filter((s) => s.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <>
      {embedded ? (
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            {!isFinanceManager && (
              <p className="text-sm text-muted-foreground">
                Manage the services and prices available to Cashiers.
              </p>
            )}
          </div>
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" /> Add service
          </Button>
        </div>
      ) : (
        <PageHeader
          eyebrow="System"
          title="Service catalog"
          description="Cashiers can only charge catalog prices. A new price takes effect once the Finance Manager approves it."
          actions={
            <Button onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4" /> Add service
            </Button>
          }
        />
      )}
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Search services"
        className="mb-6 max-w-sm"
      />
      {!list.length && <EmptyState title="No services found" />}
      {CATS.map((c) => {
        const items = list.filter((s) => s.category === c.id);
        if (!items.length) return null;
        return (
          <section key={c.id} className="mb-8">
            <SectionTitle title={c.label} />
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {items.map((s) => (
                <Panel
                  key={s.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Edit ${s.name} and view price history`}
                  className="flex cursor-pointer flex-col transition-colors hover:border-primary/40 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setEditing(s)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setEditing(s);
                    }
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-semibold">{s.name}</h3>
                    <Badge variant={s.available ? "success" : "muted"}>
                      {s.available ? "Available" : "Unavailable"}
                    </Badge>
                  </div>
                  <Field
                    className="mt-4"
                    label="Current price"
                    value={
                      <span className="font-display text-xl text-primary">{money(s.price)}</span>
                    }
                  />
                  {s.proposedPrice !== undefined && (
                    <Badge variant="info" className="mt-3 w-fit whitespace-normal">
                      {money(s.proposedPrice)} awaiting Finance approval
                    </Badge>
                  )}
                </Panel>
              ))}
            </div>
          </section>
        );
      })}
      {editing && (
        <ServiceDialog
          service={editing === "new" ? null : editing}
          financeManager={isFinanceManager}
          nested={embedded}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function ServiceDialog({
  service,
  financeManager,
  nested,
  onClose,
}: {
  service: HotelService | null;
  financeManager: boolean;
  nested: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState(service?.name ?? "");
  const [category, setCategory] = useState<ServiceCategory>(service?.category ?? "food");
  const [available, setAvailable] = useState(service?.available ?? true);
  const [price, setPrice] = useState(service ? String(service.price) : "");
  const [reason, setReason] = useState("");
  const changing = Boolean(service && Number(price) !== service.price);
  const priceHistory = useQuery({
    queryKey: ["service-price-history", service?.id],
    queryFn: () => (service ? catalogService.priceHistory(service.id) : Promise.resolve([])),
    enabled: Boolean(service),
  });
  const save = useAction(
    () =>
      service
        ? catalogService.update(service.id, {
            name: name.trim(),
            category,
            available,
            ...(changing ? { price: Number(price), priceReason: reason.trim() } : {}),
          })
        : catalogService.create({ name: name.trim(), category, available, price: Number(price) }),
    {
      success: changing
        ? "Saved. The new price was sent to Finance for approval."
        : service
          ? "Service saved."
          : financeManager
            ? "Service added and available to Cashiers."
            : "Service saved. Its initial price is awaiting Finance approval.",
      onSuccess: onClose,
    },
  );
  return (
    <FormDialog
      open
      nested={nested}
      onOpenChange={(o) => !o && onClose()}
      title={service ? "Edit service" : "Add service"}
      description={service ? "Update service details and review its price history." : undefined}
      submitLabel={service ? "Save changes" : "Add service"}
      pending={save.isPending}
      onSubmit={() => save.mutate(undefined)}
    >
      <TextField id="svc-name" label="Service name" required value={name} onChange={setName} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="svc-cat">Category</Label>
          <Select value={category} onValueChange={(v) => setCategory(v as ServiceCategory)}>
            <SelectTrigger id="svc-cat" className="h-9 bg-surface">
              <SelectValue />
            </SelectTrigger>
            <SelectContent
              position="item-aligned"
              className={nested ? "z-[100]" : "z-[60]"}
            >
              {CATS.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <TextField
          id="svc-price"
          label={service ? "Price (ETB)" : "Initial price (ETB)"}
          required
          type="number"
          value={price}
          onChange={setPrice}
        />
      </div>
      {changing && (
        <TextField
          id="svc-reason"
          label="Reason for the price change"
          required
          value={reason}
          onChange={setReason}
          hint="The current price stays in effect until the Finance Manager approves."
        />
      )}
      <label className="flex items-center justify-between gap-4 rounded-lg border bg-surface p-3 text-sm">
        Available to cashiers
        <Switch checked={available} onCheckedChange={setAvailable} />
      </label>
      {service && (
        <section className="space-y-2 border-t pt-3">
          <h3 className="text-sm font-semibold">Price history</h3>
          {priceHistory.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading price history…</p>
          ) : priceHistory.isError ? (
            <p className="text-sm text-destructive">
              Price history could not be loaded. Close and reopen this dialog to retry.
            </p>
          ) : !priceHistory.data?.length ? (
            <p className="text-sm text-muted-foreground">No price history is available.</p>
          ) : (
            <ul className="max-h-40 divide-y overflow-y-auto">
              {[...priceHistory.data].reverse().map((entry, index) => (
                <li
                  key={`${entry.effectiveFrom}-${index}`}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <div>
                    <div className="text-sm">{dateTime(entry.effectiveFrom)}</div>
                    <div className="text-xs text-muted-foreground">{entry.approvedBy}</div>
                  </div>
                  <div className="font-semibold tabular-nums">{money(entry.price)}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </FormDialog>
  );
}
