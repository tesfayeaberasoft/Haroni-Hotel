import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader } from "@/components/common/PageHeader";
import { DecisionActions } from "@/components/finance/DecisionActions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { q } from "@/lib/queries";
import type { CreditTransaction } from "@/types";
import { TransactionsTable } from "@/components/transactions/TransactionParts";

export type FinanceApprovalTab = "approvals" | "exceptions";

export function FinanceApprovalViews({
  initialTab = "approvals",
  onSelect,
}: {
  initialTab?: FinanceApprovalTab;
  onSelect?: ((transaction: CreditTransaction) => void) | undefined;
}) {
  const [tab, setTab] = useState<FinanceApprovalTab>(initialTab);
  const { data: approvals } = useSuspenseQuery(q.transactions({ status: "pending_finance" }));
  const { data: exceptions } = useSuspenseQuery(q.transactions({ status: "pending_exception" }));

  return (
    <Tabs value={tab} onValueChange={(value) => setTab(value as FinanceApprovalTab)}>
      <TabsList className="mb-4 grid h-auto w-full grid-cols-2">
        <TabsTrigger value="approvals" className="min-w-0 flex-1 whitespace-normal px-2 text-center">
          Transaction approvals ({approvals.length})
        </TabsTrigger>
        <TabsTrigger value="exceptions" className="min-w-0 flex-1 whitespace-normal px-2 text-center">
          Exceptional credit ({exceptions.length})
        </TabsTrigger>
      </TabsList>
      <TabsContent value="approvals">
        <TransactionsTable
          rows={approvals}
          onRowClick={onSelect}
          {...(!onSelect ? { detailTo: "/finance/transactions/$id" as const } : {})}
          actions={(tx) => <DecisionActions tx={tx} />}
          empty="Nothing is waiting for approval."
        />
      </TabsContent>
      <TabsContent value="exceptions">
        <TransactionsTable
          rows={exceptions}
          onRowClick={onSelect}
          {...(!onSelect ? { detailTo: "/finance/transactions/$id" as const } : {})}
          actions={(tx) => <DecisionActions tx={tx} />}
          empty="No exceptional credit is waiting."
        />
      </TabsContent>
    </Tabs>
  );
}

export function FinanceTransactionList({
  status,
  onSelect,
}: {
  status: CreditTransaction["status"];
  onSelect?: ((transaction: CreditTransaction) => void) | undefined;
}) {
  const { data } = useSuspenseQuery(q.transactions({ status }));
  return (
    <TransactionsTable
      rows={data}
      onRowClick={onSelect}
      {...(!onSelect ? { detailTo: "/finance/transactions/$id" as const } : {})}
    />
  );
}

export function FinanceApprovalPage() {
  return (
    <>
      <PageHeader
        eyebrow="Approvals"
        title="Finance approvals"
        description="Review guest-confirmed transactions and exceptional credit in one place."
      />
      <FinanceApprovalViews />
    </>
  );
}
