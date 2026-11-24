import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  BadgeCheck,
  ClipboardList,
  Landmark,
  PlusCircle,
  Tags,
  UserRound,
  XCircle,
} from "lucide-react";
import { Suspense, useState } from "react";
import {
  CashierHistoryContent,
  CashierNewTransactionContent,
  CashierPendingContent,
  type CashierPendingTab,
  CashierTransactionDetails,
  CashierWorkflowFallback,
} from "@/components/cashier/CashierWorkflows";
import {
  CASHIER_MODAL_CONTENT_CLASS,
  CASHIER_MODAL_OVERLAY_CLASS,
  CASHIER_MODAL_SCROLL_CLASS,
  CASHIER_NEW_MODAL_CONTENT_CLASS,
  CASHIER_NEW_MODAL_SCROLL_CLASS,
} from "@/components/cashier/modal-styles";
import { PageHeader, SectionTitle } from "@/components/common/PageHeader";
import { PaginationControls } from "@/components/common/PaginationControls";
import { StatCard } from "@/components/common/StatCard";
import { TransactionsTable } from "@/components/transactions/TransactionParts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePaginatedItems } from "@/hooks/use-pagination";
import { q } from "@/lib/queries";
import { pageHead } from "@/lib/seo";
import type { TransactionStatus } from "@/types";

export const Route = createFileRoute("/_portal/cashier/")({
  head: () =>
    pageHead("Cashier Dashboard", "Record credit transactions and follow their confirmation."),
  loader: ({ context }) => context.queryClient.ensureQueryData(q.cashierDashboard()),
  component: CashierDashboard,
});

function CashierDashboard() {
  const { data: d } = useSuspenseQuery(q.cashierDashboard());
  const recentTransactionsPagination = usePaginatedItems(d.recent, "", 10);
  const [workflow, setWorkflow] = useState<"new" | "pending" | "history" | null>(null);
  const [selectedTransactionId, setSelectedTransactionId] = useState<string | null>(null);
  const [pendingTab, setPendingTab] = useState<CashierPendingTab>("all");
  const [historyStatus, setHistoryStatus] = useState<TransactionStatus | "all">("all");
  const [historyOnlyMine, setHistoryOnlyMine] = useState(false);
  const workflowCopy =
    workflow === "new"
      ? {
          title: "New transaction",
          description: "Choose a guest, add services, then submit for confirmation.",
        }
      : workflow === "pending"
        ? {
            title: "Pending & disputes",
            description: "Review transactions awaiting guest confirmation or Finance action.",
          }
        : {
            title: "Transaction history",
            description: "Search, filter, and review transactions recorded at the desk.",
          };
  const openPending = (tab: CashierPendingTab) => {
    setPendingTab(tab);
    setWorkflow("pending");
  };
  const openHistory = (status: TransactionStatus | "all" = "all", onlyMine = false) => {
    setHistoryStatus(status);
    setHistoryOnlyMine(onlyMine);
    setWorkflow("history");
  };

  return (
    <>
      <PageHeader
        eyebrow="Cashier"
        title="Credit desk"
        description="Record services taken on credit and follow them through guest confirmation and Finance approval."
        actions={
          <>
            <Button variant="outline" onClick={() => openPending("all")} aria-haspopup="dialog">
              <AlertTriangle className="h-4 w-4" /> Pending & disputes
            </Button>
            <Button onClick={() => setWorkflow("new")} aria-haspopup="dialog">
              <PlusCircle className="h-4 w-4" /> New transaction
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          label="Awaiting guest"
          value={d.pendingGuest}
          icon={UserRound}
          tone="warning"
          highlight={d.pendingGuest > 0}
          onClick={() => openPending("guest")}
        />
        <StatCard
          label="Disputed"
          value={d.disputed}
          icon={AlertTriangle}
          tone="danger"
          delay={40}
          hint="Correct or cancel these"
          onClick={() => openPending("disputed")}
        />
        <StatCard
          label="Awaiting price approval"
          value={d.pendingPrice}
          icon={Tags}
          tone="info"
          delay={80}
          onClick={() => openPending("price")}
        />
        <StatCard
          label="Awaiting Finance"
          value={d.awaitingFinance}
          icon={Landmark}
          tone="gold"
          delay={120}
          onClick={() => openPending("finance")}
        />
        <StatCard
          label="Approved"
          value={d.approved}
          icon={BadgeCheck}
          tone="success"
          delay={160}
          onClick={() => openHistory("approved")}
        />
        <StatCard
          label="Rejected"
          value={d.rejected}
          icon={XCircle}
          tone="muted"
          delay={200}
          onClick={() => openHistory("rejected")}
        />
        <StatCard
          label="Recorded by me"
          value={d.recordedByMe}
          icon={ClipboardList}
          tone="gold"
          delay={240}
          onClick={() => openHistory("all", true)}
        />
        <StatCard
          label="All transactions"
          value={d.totalRecorded}
          icon={ClipboardList}
          tone="muted"
          delay={280}
          onClick={() => openHistory()}
        />
      </div>
      <div className="mt-8">
        <SectionTitle
          title="Recent transactions"
          action={
            <Button variant="link" onClick={() => openHistory()} aria-haspopup="dialog">
              View all
            </Button>
          }
        />
        <TransactionsTable
          rows={recentTransactionsPagination.currentItems}
          onRowClick={(tx) => setSelectedTransactionId(tx.id)}
        />
        {d.recent.length > 10 && <PaginationControls {...recentTransactionsPagination} />}
      </div>
      <Dialog open={workflow !== null} onOpenChange={(open) => !open && setWorkflow(null)}>
        <DialogContent
          overlayClassName={CASHIER_MODAL_OVERLAY_CLASS}
          scrollAreaClassName={
            workflow === "new" ? CASHIER_NEW_MODAL_SCROLL_CLASS : CASHIER_MODAL_SCROLL_CLASS
          }
          className={
            workflow === "new" ? CASHIER_NEW_MODAL_CONTENT_CLASS : CASHIER_MODAL_CONTENT_CLASS
          }
        >
          <DialogHeader className="sticky top-0 z-10 bg-background/95 pb-2 pr-10 backdrop-blur">
            <DialogTitle className="font-display text-xl">{workflowCopy.title}</DialogTitle>
            <DialogDescription>{workflowCopy.description}</DialogDescription>
          </DialogHeader>
          {workflow === "new" && (
            <Suspense fallback={<CashierWorkflowFallback label="Loading guests and services..." />}>
              <CashierNewTransactionContent compact onSuccess={() => setWorkflow(null)} />
            </Suspense>
          )}
          {workflow === "pending" && (
            <Suspense
              fallback={<CashierWorkflowFallback label="Loading pending transactions..." />}
            >
              <CashierPendingContent
                key={pendingTab}
                initialTab={pendingTab}
                onSelect={(tx) => setSelectedTransactionId(tx.id)}
              />
            </Suspense>
          )}
          {workflow === "history" && (
            <Suspense fallback={<CashierWorkflowFallback label="Loading transaction history..." />}>
              <CashierHistoryContent
                key={`${historyStatus}:${historyOnlyMine}`}
                initialStatus={historyStatus}
                onlyMine={historyOnlyMine}
                onSelect={(tx) => setSelectedTransactionId(tx.id)}
              />
            </Suspense>
          )}
        </DialogContent>
      </Dialog>
      <CashierTransactionDetails
        transactionId={selectedTransactionId}
        onClose={() => setSelectedTransactionId(null)}
        nested={workflow !== null}
      />
    </>
  );
}
