import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/common/PageHeader";
import { CashierHistoryContent } from "@/components/cashier/CashierWorkflows";
import { q } from "@/lib/queries";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/_portal/cashier/history")({
  head: () => pageHead("Transaction History", "Every credit transaction recorded at the desk."),
  loader: ({ context }) => context.queryClient.ensureQueryData(q.transactions()),
  component: HistoryPage,
});

function HistoryPage() {
  return (
    <>
      <PageHeader eyebrow="Credit desk" title="Transaction history" description="Every credit transaction recorded at the desk." />
      <CashierHistoryContent />
    </>
  );
}
