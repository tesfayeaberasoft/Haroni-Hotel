import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { TransactionDetail } from "@/components/transactions/TransactionParts";
import { CashierTransactionActions, InHotelConfirm } from "@/components/cashier/CashierWorkflows";
import { Button } from "@/components/ui/button";
import { q } from "@/lib/queries";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/_portal/cashier/transactions/$id")({
  head: () => pageHead("Transaction Details", "Confirm, correct or cancel a credit transaction."),
  loader: ({ context, params }) => context.queryClient.ensureQueryData(q.transaction(params.id)),
  component: CashierTransactionPage,
});

function CashierTransactionPage() {
  const { id } = Route.useParams();
  const { data } = useSuspenseQuery(q.transaction(id));
  const { transaction: tx } = data;

  return (
    <>
      <PageHeader
        eyebrow="Credit desk"
        title={`Transaction ${tx.code}`}
        actions={
          <Button variant="ghost" asChild>
            <Link to="/cashier/history">
              <ArrowLeft className="h-4 w-4" /> All transactions
            </Link>
          </Button>
        }
      />
      <TransactionDetail
        tx={tx}
        aside={tx.status === "pending_guest" ? <InHotelConfirm tx={tx} /> : undefined}
        showCreditAmounts={false}
      />
      <CashierTransactionActions tx={tx} />
    </>
  );
}
