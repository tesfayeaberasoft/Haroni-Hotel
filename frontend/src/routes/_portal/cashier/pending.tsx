import { createFileRoute } from "@tanstack/react-router";
import { CashierPendingContent } from "@/components/cashier/CashierWorkflows";
import { PageHeader } from "@/components/common/PageHeader";
import { RESERVING_STATUSES } from "@/lib/credit";
import { q } from "@/lib/queries";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/_portal/cashier/pending")({
  head: () => pageHead("Pending & Disputes", "Transactions waiting for the guest, Finance, or a correction."),
  loader: ({ context }) => context.queryClient.ensureQueryData(q.transactions({ status: RESERVING_STATUSES })),
  component: PendingPage,
});

function PendingPage() {
  return (
    <>
      <PageHeader eyebrow="Credit desk" title="Pending & disputes" description="Open a transaction to confirm it in the hotel with the guest's PIN or SMS code, correct it, or cancel it." />
      <CashierPendingContent />
    </>
  );
}
