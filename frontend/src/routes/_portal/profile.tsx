import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { KeyRound, LogOut } from "lucide-react";
import { useState } from "react";
import { PageHeader, SectionTitle } from "@/components/common/PageHeader";
import { Field, Panel } from "@/components/common/Panel";
import { Spinner } from "@/components/common/States";
import { AccountStatusBadge } from "@/components/common/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/hooks/use-action";
import { ROLE_LABEL, useAuth } from "@/hooks/use-auth";
import { initials } from "@/lib/format";
import { pageHead } from "@/lib/seo";
import { authService } from "@/services/auth.service";
import { USE_DEMO_BACKEND } from "@/services/config";

export const Route = createFileRoute("/_portal/profile")({
  head: () => pageHead("My Profile", "Your Haroni Hotel account details and password."),
  component: ProfilePage,
});

function ProfilePage() {
  const { session, logout } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pinPassword, setPinPassword] = useState("");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const change = useAction((v: { c: string; n: string }) => authService.changePassword(v.c, v.n), {
    success: "Password changed.",
    onSuccess: () => {
      setCurrent("");
      setNext("");
      setConfirm("");
    },
  });
  const setPinAction = useAction((v: { pin: string; password: string }) => authService.setConfirmationPin(v.pin, v.password), {
    success: "Confirmation PIN saved.",
    onSuccess: () => {
      setPinPassword("");
      setPin("");
      setPinConfirm("");
    },
  });
  if (!session) return null;
  const u = session.user;

  return (
    <>
      <PageHeader eyebrow="Account" title="My profile" description="Your personal account information." />
      <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
        <Panel>
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gold-gradient font-display text-2xl font-bold text-primary-foreground shadow-gold">{initials(u.fullName)}</div>
            <div>
              <div className="font-display text-2xl font-semibold">{u.fullName}</div>
              <Badge variant="gold" className="mt-1">
                {ROLE_LABEL[u.role]}
              </Badge>
            </div>
          </div>
          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            <Field label="Full name" value={u.fullName} />
            <Field label="Username" value={`@${u.username}`} />
            <Field label="Phone number" value={u.phone || "—"} />
            <Field label="Account role" value={ROLE_LABEL[u.role]} />
            <Field label="Account status" value={<AccountStatusBadge status={u.status} />} />
          </div>
          <Button
            variant="outline"
            className="mt-8"
            onClick={async () => {
              await logout();
              void navigate({ to: "/", replace: true });
            }}
          >
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </Panel>
        <Panel delay={80}>
          <SectionTitle title="Change password" />
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setErr(null);
              if (!USE_DEMO_BACKEND && (new TextEncoder().encode(next).length < 12 || new TextEncoder().encode(next).length > 72)) {
                return setErr("New password must contain 12 to 72 bytes.");
              }
              if (USE_DEMO_BACKEND && next.length < 6) return setErr("New password must be at least 6 characters.");
              if (next !== confirm) return setErr("The new passwords do not match.");
              change.mutate({ c: current, n: next });
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="cur">Current password</Label>
              <Input id="cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new">New password</Label>
              <Input id="new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="conf">Confirm new password</Label>
              <Input id="conf" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}
            <Button type="submit" disabled={change.isPending || !current}>
              {change.isPending ? <Spinner className="h-4 w-4 text-current" /> : <KeyRound className="h-4 w-4" />} Update password
            </Button>
          </form>
        </Panel>
        {!USE_DEMO_BACKEND && u.role === "guest" && <Panel delay={120}>
          <SectionTitle title="In-person confirmation PIN" />
          <p className="mb-4 text-sm text-muted-foreground">Set a 6–12 digit PIN for confirming charges with a cashier. Your PIN is stored as a secure hash.</p>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setPinError(null);
              if (!/^\d{6,12}$/.test(pin)) return setPinError("PIN must contain 6 to 12 digits.");
              if (pin !== pinConfirm) return setPinError("The PIN entries do not match.");
              setPinAction.mutate({ pin, password: pinPassword });
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="pin-current-password">Current password</Label>
              <Input id="pin-current-password" type="password" autoComplete="current-password" value={pinPassword} onChange={(e) => setPinPassword(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmation-pin">New PIN</Label>
              <Input id="confirmation-pin" type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 12))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmation-pin-repeat">Confirm PIN</Label>
              <Input id="confirmation-pin-repeat" type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={pinConfirm} onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, "").slice(0, 12))} />
            </div>
            {pinError && <p className="text-sm text-destructive">{pinError}</p>}
            <Button type="submit" disabled={setPinAction.isPending || !pinPassword}>
              {setPinAction.isPending && <Spinner className="h-4 w-4 text-current" />} Save PIN
            </Button>
          </form>
        </Panel>}
      </div>
    </>
  );
}
