import { createFileRoute } from "@tanstack/react-router";
import { FinanceApprovalPage } from "@/components/finance/FinanceApprovalViews";
import { q } from "@/lib/queries";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/_portal/finance/approvals")({
  head: () =>
    pageHead(
      "Finance Approvals",
      "Review guest-confirmed transactions, exceptional credit, and pending price requests.",
    ),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(q.transactions({ status: "pending_finance" })),
      context.queryClient.ensureQueryData(q.transactions({ status: "pending_exception" })),
    ]),
  component: FinanceApprovalPage,
});
