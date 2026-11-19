import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PlusCircle } from "lucide-react";
import { Suspense, useState } from "react";
import {
  CashierNewTransactionContent,
  CashierWorkflowFallback,
} from "@/components/cashier/CashierWorkflows";
import {
  CASHIER_MODAL_OVERLAY_CLASS,
  CASHIER_NEW_MODAL_CONTENT_CLASS,
  CASHIER_NEW_MODAL_SCROLL_CLASS,
} from "@/components/cashier/modal-styles";
import { PageHeader } from "@/components/common/PageHeader";
import { Panel } from "@/components/common/Panel";
import { SearchInput } from "@/components/common/SearchInput";
import { EmptyState } from "@/components/common/States";
import { AccountStatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { q } from "@/lib/queries";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/_portal/cashier/guests")({
  head: () => pageHead("Guest Search", "Find a guest to record services they received."),
  loader: ({ context }) => context.queryClient.ensureQueryData(q.guestAccounts()),
  component: GuestSearch,
});

function GuestSearch() {
  const { data: guests } = useSuspenseQuery(q.guestAccounts());
  const [search, setSearch] = useState("");
  const [selectedGuestId, setSelectedGuestId] = useState<string | null>(null);
  const term = search.toLowerCase().replace(/\s/g, "");
  const list = guests.filter((g) =>
    `${g.fullName}${g.username}${g.phone}`.toLowerCase().replace(/\s/g, "").includes(term),
  );

  const openNewTransaction = (guestId: string) => setSelectedGuestId(guestId);

  return (
    <>
      <PageHeader
        eyebrow="Credit desk"
        title="Guest search"
        description="Find a guest to start recording the services they received."
      />
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Search by name, username or phone"
        className="mb-6 max-w-md"
      />
      {!list.length && (
        <EmptyState
          title="No guests found"
          description="Ask the Administrator to register the guest first."
        />
      )}
      <div className="flex flex-wrap gap-4">
        {list.map((g, i) => (
          <Panel
            key={g.id}
            delay={Math.min(i, 8) * 30}
            role="button"
            tabIndex={0}
            aria-label={`Start a transaction for ${g.fullName}`}
            aria-haspopup="dialog"
            className="min-w-0 flex-grow basis-full cursor-pointer transition-colors hover:border-primary/40 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:basis-[calc(50%_-_0.5rem)] xl:basis-[calc(33.333%_-_0.667rem)]"
            onClick={() => openNewTransaction(g.id)}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openNewTransaction(g.id);
              }
            }}
          >
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate font-display text-xl font-semibold">{g.fullName}</h2>
                <p className="text-sm text-muted-foreground">
                  @{g.username} · {g.phone}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <AccountStatusBadge status={g.status} />
                <Button
                  size="sm"
                  aria-haspopup="dialog"
                  onClick={(event) => {
                    event.stopPropagation();
                    openNewTransaction(g.id);
                  }}
                >
                  <PlusCircle className="h-4 w-4" /> New transaction
                </Button>
              </div>
            </div>
          </Panel>
        ))}
      </div>
      <Dialog
        open={selectedGuestId !== null}
        onOpenChange={(open) => !open && setSelectedGuestId(null)}
      >
        <DialogContent
          overlayClassName={CASHIER_MODAL_OVERLAY_CLASS}
          scrollAreaClassName={CASHIER_NEW_MODAL_SCROLL_CLASS}
          className={CASHIER_NEW_MODAL_CONTENT_CLASS}
        >
          <DialogHeader className="sticky top-0 z-10 bg-background/95 pb-2 pr-10 backdrop-blur">
            <DialogTitle className="font-display text-xl">New transaction</DialogTitle>
            <DialogDescription>
              Choose the services received and submit them for guest confirmation.
            </DialogDescription>
          </DialogHeader>
          <Suspense fallback={<CashierWorkflowFallback label="Loading guests and services..." />}>
            {selectedGuestId && (
              <CashierNewTransactionContent
                key={selectedGuestId}
                initialGuestId={selectedGuestId}
                compact
                onSuccess={() => setSelectedGuestId(null)}
              />
            )}
          </Suspense>
        </DialogContent>
      </Dialog>
    </>
  );
}
