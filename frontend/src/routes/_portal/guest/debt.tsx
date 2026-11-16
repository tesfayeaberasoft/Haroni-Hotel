import { createFileRoute } from "@tanstack/react-router";
import { GuestDebt } from "@/components/guest/GuestScreens";
import { q } from "@/lib/queries";
import { pageHead } from "@/lib/seo";
import { USE_DEMO_BACKEND } from "@/services/config";

export const Route = createFileRoute("/_portal/guest/debt")({
  head: () => pageHead("Debt Details", "Your outstanding balance breakdown and downloadable statement."),
  loader: ({ context }) => {
    if (USE_DEMO_BACKEND) {
      return Promise.all([
        context.queryClient.ensureQueryData(q.myStatement()),
        context.queryClient.ensureQueryData(q.payments()),
        context.queryClient.ensureQueryData(q.settings()),
      ]);
    }
    return Promise.all([
      context.queryClient.ensureQueryData(q.myStatement()),
      context.queryClient.ensureQueryData(q.payments()),
    ]);
  },
  component: GuestDebt,
});
