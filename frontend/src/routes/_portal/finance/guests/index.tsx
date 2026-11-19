import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/common/PageHeader";
import { GuestFinanceDetailDialog, GuestFinanceList } from "@/components/finance/GuestFinanceViews";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GuestDialog } from "@/components/admin/GuestManagement";
import { UsersPage } from "@/components/admin/UserManagement";
import { q } from "@/lib/queries";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/_portal/finance/guests/")({
  head: () => pageHead("Finance Accounts", "Guest finances and staff user management."),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(q.guestAccounts()),
      context.queryClient.ensureQueryData(q.users()),
    ]),
  component: GuestFinances,
});

function GuestFinances() {
  const [selectedGuestId, setSelectedGuestId] = useState<string | null>(null);
  const [registerGuest, setRegisterGuest] = useState(false);

  return (
    <>
      <PageHeader
        eyebrow="Accounts"
        title="Accounts & finances"
        description="Review guest balances and manage guest and staff accounts in one place."
      />
      <Tabs defaultValue="finances" className="space-y-4">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="finances">Guest finances</TabsTrigger>
          <TabsTrigger value="staff">Staff users</TabsTrigger>
        </TabsList>
        <TabsContent value="finances">
          <GuestFinanceList
            compactColumns
            onSelect={(guest) => setSelectedGuestId(guest.id)}
            onRegister={() => setRegisterGuest(true)}
          />
        </TabsContent>
        <TabsContent value="staff">
          <UsersPage />
        </TabsContent>
      </Tabs>
      <GuestFinanceDetailDialog
        guestId={selectedGuestId}
        onClose={() => setSelectedGuestId(null)}
      />
      {registerGuest && <GuestDialog guest={null} onClose={() => setRegisterGuest(false)} />}
    </>
  );
}
