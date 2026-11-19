import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CashierNewTransactionContent } from "@/components/cashier/CashierWorkflows";
import { PageHeader } from "@/components/common/PageHeader";
import { q } from "@/lib/queries";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/_portal/cashier/new")({
  head: () => pageHead("New Transaction", "Record services a guest took on credit."),
  validateSearch: (search: Record<string, unknown>): { guestId?: string } =>
    typeof search["guestId"] === "string" && search["guestId"] ? { guestId: search["guestId"] } : {},
  loader: ({ context }) => Promise.all([context.queryClient.ensureQueryData(q.guestAccounts()), context.queryClient.ensureQueryData(q.services())]),
  component: NewTransaction,
});

function NewTransaction() {
  const search = Route.useSearch();
  const navigate = useNavigate();

  return (
    <>
      <PageHeader eyebrow="Credit desk" title="New transaction" description="Choose the guest, add the services they took, then send it to them to confirm." />
      <CashierNewTransactionContent
        initialGuestId={search.guestId}
        onSuccess={(tx) => void navigate({ to: "/cashier/transactions/$id", params: { id: tx.id } })}
      />
    </>
  );
}
