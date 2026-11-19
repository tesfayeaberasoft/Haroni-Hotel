import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  Banknote,
  Landmark,
  ListChecks,
  Plus,
  Settings,
  ShieldAlert,
  Tags,
  UserPlus,
  Wallet,
} from "lucide-react";
import { Suspense, useState } from "react";
import { SystemSettingsManager } from "@/components/admin/SystemSettingsManager";
import { GuestDialog } from "@/components/admin/GuestManagement";
import { ServicesPage } from "@/components/admin/ServiceCatalog";
import { UserDialog } from "@/components/admin/UserManagement";
import { CreditPaymentsChart } from "@/components/common/Charts";
import { PageHeader, SectionTitle } from "@/components/common/PageHeader";
import { Panel } from "@/components/common/Panel";
import { PaginationControls } from "@/components/common/PaginationControls";
import {
  PORTAL_MODAL_OVERLAY_CLASS,
  PORTAL_MODAL_SCROLL_CLASS,
  PORTAL_WIDE_MODAL_CONTENT_CLASS,
} from "@/components/common/modal-styles";
import { EmptyState, Spinner } from "@/components/common/States";
import { StatCard } from "@/components/common/StatCard";
import {
  FinanceApprovalViews,
  FinanceTransactionList,
  type FinanceApprovalTab,
} from "@/components/finance/FinanceApprovalViews";
import {
  FinanceTransactionDetailDialog,
  GuestFinanceDetailDialog,
  GuestFinanceList,
} from "@/components/finance/GuestFinanceViews";
import {
  HistoricalRecordDialog,
  HistoricalRecordsContent,
} from "@/components/finance/HistoricalViews";
import {
  FinanceRecordPaymentDialog,
  PaymentDetailDialog,
  PaymentHistoryContent,
  PaymentMethodBadge,
} from "@/components/finance/PaymentParts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { usePaginatedItems } from "@/hooks/use-pagination";
import { date, money, moneyCompact } from "@/lib/format";
import { q } from "@/lib/queries";
import { pageHead } from "@/lib/seo";
import type { Payment } from "@/types";

type FinanceDashboardModal = "approvals" | "historical" | "payments" | "guests" | "approved";
type DashboardAdminModal = "settings" | "services" | null;

export const Route = createFileRoute("/_portal/finance/")({
  head: () =>
    pageHead(
      "Finance Dashboard",
      "Outstanding debt, approvals, payments and credit risk at a glance.",
    ),
  loader: ({ context }) => context.queryClient.ensureQueryData(q.financeDashboard()),
  component: FinanceDashboard,
});

function FinanceDashboard() {
  const { data: dashboard } = useSuspenseQuery(q.financeDashboard());
  const recentPaymentsPagination = usePaginatedItems(
    dashboard.recentPayments,
    dashboard.recentPayments.map((payment) => payment.id).join(":"),
    4,
  );
  const [modal, setModal] = useState<FinanceDashboardModal | null>(null);
  const [approvalTab, setApprovalTab] = useState<FinanceApprovalTab>("approvals");
  const [overLimitOnly, setOverLimitOnly] = useState(false);
  const [historicalDialogOpen, setHistoricalDialogOpen] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [selectedGuestId, setSelectedGuestId] = useState<string | null>(null);
  const [selectedTransactionId, setSelectedTransactionId] = useState<string | null>(null);
  const [adminModal, setAdminModal] = useState<DashboardAdminModal>(null);
  const [registerGuest, setRegisterGuest] = useState(false);
  const [addStaffUser, setAddStaffUser] = useState(false);
  const [recordPaymentOpen, setRecordPaymentOpen] = useState(false);
  const historicalProgress =
    dashboard.historicalTarget > 0
      ? Math.min(100, (dashboard.totalHistorical / dashboard.historicalTarget) * 100)
      : 0;

  const openApprovals = (tab: FinanceApprovalTab) => {
    setApprovalTab(tab);
    setModal("approvals");
  };
  const closeModal = () => {
    setModal(null);
    setSelectedGuestId(null);
    setSelectedPayment(null);
    setSelectedTransactionId(null);
  };
  const modalTitle =
    modal === "approvals"
      ? "Approvals"
      : modal === "historical"
        ? "Historical records to verify"
        : modal === "payments"
          ? "Payment history"
          : modal === "guests"
            ? overLimitOnly
              ? "Guests over their limit"
              : "Guest finances"
            : "Approved transactions";

  const queue = [
    {
      label: "Transaction approvals",
      count: dashboard.pendingApprovals,
      icon: ListChecks,
      onClick: () => openApprovals("approvals"),
    },
    {
      label: "Exceptional credit",
      count: dashboard.pendingExceptions,
      icon: ShieldAlert,
      onClick: () => openApprovals("exceptions"),
    },
    {
      label: "Historical records to verify",
      count: dashboard.pendingHistorical,
      icon: Landmark,
      onClick: () => setModal("historical"),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Finance"
        title="Finance overview"
        description={`${dashboard.guestCount} guest accounts on credit.`}
        actions={
          <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:grid-cols-3">
            <Button
              className="h-9 w-full justify-start whitespace-nowrap px-3 text-xs sm:text-sm"
              variant="outline"
              onClick={() => setHistoricalDialogOpen(true)}
            >
              <Plus className="h-4 w-4" /> Add record
            </Button>
            <Button
              className="h-9 w-full justify-start whitespace-nowrap px-3 text-xs sm:text-sm"
              variant="outline"
              onClick={() => setRegisterGuest(true)}
            >
              <UserPlus className="h-4 w-4" /> Register Guest
            </Button>
            <Button
              className="h-9 w-full justify-start whitespace-nowrap px-3 text-xs sm:text-sm"
              variant="outline"
              onClick={() => setAddStaffUser(true)}
            >
              <UserPlus className="h-4 w-4" /> Add Staff User
            </Button>
            <Button
              className="h-9 w-full justify-start whitespace-nowrap px-3 text-xs sm:text-sm"
              variant="outline"
              onClick={() => setAdminModal("services")}
            >
              <Tags className="h-4 w-4" /> Service Catalog
            </Button>
            <Button
              className="h-9 w-full justify-start whitespace-nowrap px-3 text-xs sm:text-sm"
              variant="outline"
              onClick={() => setAdminModal("settings")}
            >
              <Settings className="h-4 w-4" /> System Settings
            </Button>
            <Button
              className="h-9 w-full justify-start whitespace-nowrap px-3 text-xs sm:text-sm"
              onClick={() => setRecordPaymentOpen(true)}
            >
              <Banknote className="h-4 w-4" /> Record payment
            </Button>
          </div>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Outstanding debt"
          value={moneyCompact(dashboard.totalOutstanding)}
          hint={money(dashboard.totalOutstanding)}
          icon={Wallet}
          highlight
          onClick={() => {
            setOverLimitOnly(false);
            setModal("guests");
          }}
        />
        <StatCard
          label="Approved credit"
          value={moneyCompact(dashboard.totalApprovedCredit)}
          hint={`${dashboard.approvedCount} transactions`}
          icon={ListChecks}
          tone="info"
          delay={40}
          onClick={() => setModal("approved")}
        />
        <StatCard
          label="Payments received"
          value={moneyCompact(dashboard.totalPayments)}
          hint={money(dashboard.totalPayments)}
          icon={Banknote}
          tone="success"
          delay={80}
          onClick={() => setModal("payments")}
        />
        <StatCard
          label="Guests over limit"
          value={dashboard.exceeding.length}
          icon={AlertTriangle}
          tone={dashboard.exceeding.length ? "danger" : "muted"}
          delay={120}
          onClick={() => {
            setOverLimitOnly(true);
            setModal("guests");
          }}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        <Panel className="min-w-0">
          <SectionTitle title="Credit vs payments" />
          <CreditPaymentsChart data={dashboard.series} />
        </Panel>
        <Panel delay={60} className="min-w-0">
          <SectionTitle title="Waiting for you" />
          <ul className="space-y-2">
            {queue.map((item) => (
              <li key={item.label}>
                <button
                  type="button"
                  onClick={item.onClick}
                  aria-haspopup="dialog"
                  className="flex w-full items-center justify-between gap-3 rounded-lg border bg-surface px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex items-center gap-3 text-sm font-medium">
                    <item.icon className="h-4 w-4 text-primary" /> {item.label}
                  </span>
                  <span
                    className={
                      item.count
                        ? "font-display text-xl font-semibold text-primary"
                        : "text-sm text-muted-foreground"
                    }
                  >
                    {item.count}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-6 border-t pt-5">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Historical debt moved in
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="font-semibold tabular-nums">{money(dashboard.totalHistorical)}</span>
              <span className="text-xs text-muted-foreground">
                of {moneyCompact(dashboard.historicalTarget)}
              </span>
            </div>
            <Progress value={historicalProgress} className="mt-2 h-1.5 bg-muted" />
          </div>
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel delay={120} className="min-w-0">
          <SectionTitle title="Guests over their limit" />
          {dashboard.exceeding.length === 0 ? (
            <EmptyState title="No guest is over their limit" />
          ) : (
            <ul className="divide-y">
              {dashboard.exceeding.map((guest) => (
                <li
                  key={guest.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`View finances for ${guest.fullName}`}
                  onClick={() => setSelectedGuestId(guest.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedGuestId(guest.id);
                    }
                  }}
                  className="flex cursor-pointer items-center justify-between gap-3 py-3 transition-colors hover:bg-muted/40"
                >
                  <div className="min-w-0 font-medium">
                    <span className="block truncate">{guest.fullName}</span>
                    <span className="block text-xs text-muted-foreground">
                      Limit {money(guest.creditLimit)}
                    </span>
                  </div>
                  <span className="shrink-0 font-semibold text-destructive tabular-nums">
                    {money(guest.outstandingDebt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel delay={180} className="min-w-0">
          <SectionTitle
            title="Recent payments"
            action={
              <Button variant="link" size="sm" onClick={() => setModal("payments")}>
                View all
              </Button>
            }
          />
          {dashboard.recentPayments.length === 0 ? (
            <EmptyState title="No payments yet" />
          ) : (
            <ul className="divide-y">
              {recentPaymentsPagination.currentItems.map((payment) => (
                <li
                  key={payment.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`View payment ${payment.receiptNumber}`}
                  onClick={() => setSelectedPayment(payment)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedPayment(payment);
                    }
                  }}
                  className="flex cursor-pointer items-center justify-between gap-3 py-3 transition-colors hover:bg-muted/40"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{payment.guestName}</div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {date(payment.paidAt)}
                      <PaymentMethodBadge method={payment.method} />
                      <span>{payment.receiptNumber}</span>
                    </div>
                  </div>
                  <span className="shrink-0 font-semibold text-success tabular-nums">
                    {money(payment.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {dashboard.recentPayments.length > 4 && (
            <PaginationControls {...recentPaymentsPagination} />
          )}
        </Panel>
      </div>

      <Dialog open={modal !== null} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent
          overlayClassName={PORTAL_MODAL_OVERLAY_CLASS}
          scrollAreaClassName={PORTAL_MODAL_SCROLL_CLASS}
          className={PORTAL_WIDE_MODAL_CONTENT_CLASS}
        >
          <DialogHeader>
            <DialogTitle className="font-display text-xl">{modalTitle}</DialogTitle>
            <DialogDescription>
              Review finance details without leaving the dashboard.
            </DialogDescription>
          </DialogHeader>
          <Suspense fallback={<Spinner className="mx-auto my-8 h-6 w-6" />}>
            {modal === "approvals" && (
              <FinanceApprovalViews
                key={approvalTab}
                initialTab={approvalTab}
                onSelect={(transaction) => setSelectedTransactionId(transaction.id)}
              />
            )}
            {modal === "historical" && <HistoricalRecordsContent nested />}
            {modal === "payments" && (
              <PaymentHistoryContent onSelect={(payment) => setSelectedPayment(payment)} />
            )}
            {modal === "guests" && (
              <GuestFinanceList
                key={String(overLimitOnly)}
                initialOverOnly={overLimitOnly}
                onSelect={(guest) => setSelectedGuestId(guest.id)}
              />
            )}
            {modal === "approved" && (
              <FinanceTransactionList
                status="approved"
                onSelect={(transaction) => setSelectedTransactionId(transaction.id)}
              />
            )}
          </Suspense>
        </DialogContent>
      </Dialog>
      <GuestFinanceDetailDialog
        guestId={selectedGuestId}
        nested={modal === "guests"}
        onClose={() => setSelectedGuestId(null)}
      />
      <FinanceTransactionDetailDialog
        transactionId={selectedTransactionId}
        nested={modal !== null}
        onClose={() => setSelectedTransactionId(null)}
      />
      <PaymentDetailDialog
        payment={selectedPayment}
        nested={modal === "payments"}
        onClose={() => setSelectedPayment(null)}
      />
      {historicalDialogOpen && (
        <HistoricalRecordDialog onClose={() => setHistoricalDialogOpen(false)} />
      )}
      {recordPaymentOpen && (
        <FinanceRecordPaymentDialog onClose={() => setRecordPaymentOpen(false)} />
      )}
      {registerGuest && <GuestDialog guest={null} onClose={() => setRegisterGuest(false)} />}
      {addStaffUser && <UserDialog user={null} currentUserId={undefined} onClose={() => setAddStaffUser(false)} />}
      <Dialog open={adminModal === "settings"} onOpenChange={(open) => !open && setAdminModal(null)}>
        <DialogContent
          overlayClassName={PORTAL_MODAL_OVERLAY_CLASS}
          scrollAreaClassName={PORTAL_MODAL_SCROLL_CLASS}
          className={PORTAL_WIDE_MODAL_CONTENT_CLASS}
        >
          <DialogHeader>
            <DialogTitle className="font-display text-xl">System Settings</DialogTitle>
            <DialogDescription>Settings, database backup and restore, and audit-log export.</DialogDescription>
          </DialogHeader>
          <Suspense fallback={<Spinner className="mx-auto my-8 h-6 w-6" />}>
            <SystemSettingsManager />
          </Suspense>
        </DialogContent>
      </Dialog>
      <Dialog open={adminModal === "services"} onOpenChange={(open) => !open && setAdminModal(null)}>
        <DialogContent
          overlayClassName={PORTAL_MODAL_OVERLAY_CLASS}
          scrollAreaClassName={PORTAL_MODAL_SCROLL_CLASS}
          className={PORTAL_WIDE_MODAL_CONTENT_CLASS}
        >
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Service Catalog</DialogTitle>
            <DialogDescription>Manage services and their availability to Cashiers.</DialogDescription>
          </DialogHeader>
          <Suspense fallback={<Spinner className="mx-auto my-8 h-6 w-6" />}>
            <ServicesPage embedded />
          </Suspense>
        </DialogContent>
      </Dialog>
    </>
  );
}
