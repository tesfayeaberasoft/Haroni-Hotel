import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { DatabaseBackup, Download, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { SectionTitle } from "@/components/common/PageHeader";
import { Panel } from "@/components/common/Panel";
import { EmptyState, ErrorState, LoadingBlock, Spinner } from "@/components/common/States";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAction } from "@/hooks/use-action";
import { downloadBlob } from "@/lib/download";
import { dateTime } from "@/lib/format";
import { q } from "@/lib/queries";
import { systemService, type BackupInfo } from "@/services/system.service";
import { USE_DEMO_BACKEND } from "@/services/config";
import type { SystemSettings } from "@/types";

function csvCell(value: string) {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function SystemSettingsManager() {
  const { data } = useSuspenseQuery(q.settings());
  const [settings, setSettings] = useState<SystemSettings>(data);
  const [pendingRestore, setPendingRestore] = useState<{ name: string; snapshot: unknown } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => setSettings(data), [data]);

  const save = useAction(() => systemService.updateSettings(settings), { success: "Settings saved." });
  const exportAudit = useAction(() => systemService.auditLogs(), {
    success: "Audit logs downloaded.",
    onSuccess: (logs) => {
      const rows = [
        ["ID", "When", "Who", "Category", "Action", "Details"],
        ...logs.map((entry) => [
          entry.id,
          entry.at,
          entry.actor,
          entry.category,
          entry.action,
          entry.details ?? "",
        ]),
      ];
      const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
      downloadBlob(
        new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }),
        `haroni-audit-logs-${new Date().toISOString().slice(0, 10)}.csv`,
      );
    },
  });
  const backupsQuery = useQuery(q.backups());
  const createBackup = useAction(async () => {
    const result = await systemService.createBackup();
    if (USE_DEMO_BACKEND) {
      const stamp = result.backup.createdAt.slice(0, 19).replace(/[:T]/g, "-");
      downloadBlob(
        new Blob([JSON.stringify(result.snapshot, null, 2)], { type: "application/json" }),
        `haroni-dcms-backup-${stamp}.json`,
      );
    } else {
      await systemService.downloadBackup(result.backup.id);
    }
    return result.backup;
  }, { success: "Backup created and downloaded." });
  const downloadBackup = useAction((backup: BackupInfo) => systemService.downloadBackup(backup.id), {
    success: "Backup downloaded.",
  });
  const restore = useAction((snapshot: unknown) => systemService.restore(snapshot), {
    success: "Database restored from backup.",
    onSuccess: () => setPendingRestore(null),
  });

  const readBackupFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      let snapshot: unknown;
      try {
        snapshot = JSON.parse(text) as unknown;
      } catch {
        toast.error("That file is not a valid backup (could not read JSON).");
        return;
      }
      setPendingRestore({ name: file.name, snapshot });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The backup file could not be read.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const set = <K extends keyof SystemSettings>(key: K, value: SystemSettings[K]) =>
    setSettings((current) => ({ ...current, [key]: value }));

  return (
    <Tabs defaultValue="settings" className="space-y-3">
      <TabsList className="w-full justify-start">
        <TabsTrigger value="settings">System settings</TabsTrigger>
        <TabsTrigger value="backup">Backup &amp; restore</TabsTrigger>
      </TabsList>
      <TabsContent value="settings">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate(undefined);
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Panel className="space-y-3 p-3 sm:col-span-2">
              <SectionTitle title="Hotel profile" compact />
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="finance-settings-name">Hotel name</Label>
                  <Input id="finance-settings-name" required value={settings.hotelName} onChange={(e) => set("hotelName", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="finance-settings-address">Address</Label>
                  <Input id="finance-settings-address" value={settings.hotelAddress} onChange={(e) => set("hotelAddress", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="finance-settings-email">Email</Label>
                  <Input id="finance-settings-email" type="email" value={settings.hotelEmail} onChange={(e) => set("hotelEmail", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="finance-settings-phone">Phone</Label>
                  <Input id="finance-settings-phone" type="tel" value={settings.hotelPhone} onChange={(e) => set("hotelPhone", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="finance-settings-tin">TIN</Label>
                  <Input id="finance-settings-tin" value={settings.hotelTin} onChange={(e) => set("hotelTin", e.target.value)} />
                </div>
              </div>
            </Panel>
            <Panel className="space-y-3 p-3">
              <SectionTitle title="Guest confirmation" compact />
              <div className="space-y-1">
                <Label htmlFor="finance-settings-deadline">Confirmation deadline (hours)</Label>
                <Input
                  id="finance-settings-deadline"
                  type="number"
                  min={1}
                  max={168}
                  value={settings.confirmationDeadlineHours}
                  onChange={(e) => set("confirmationDeadlineHours", Number(e.target.value))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="finance-settings-reminder">Reminder before deadline (hours)</Label>
                <Input
                  id="finance-settings-reminder"
                  type="number"
                  min={0}
                  value={settings.reminderBeforeHours}
                  onChange={(e) => set("reminderBeforeHours", Number(e.target.value))}
                />
              </div>
            </Panel>
            <Panel className="space-y-3 p-3">
              <SectionTitle title="Finance &amp; receipts" compact />
              <div className="space-y-1">
                <Label htmlFor="finance-settings-target">Historical debt target (ETB)</Label>
                <Input
                  id="finance-settings-target"
                  type="number"
                  min={0.01}
                  step="0.01"
                  value={settings.historicalDebtTarget}
                  onChange={(e) => set("historicalDebtTarget", Number(e.target.value))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="finance-settings-footer">Receipt footer</Label>
                <Textarea id="finance-settings-footer" rows={2} value={settings.receiptFooter} onChange={(e) => set("receiptFooter", e.target.value)} />
              </div>
              <label className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm">
                Save SMS reminder preference
                <Switch checked={settings.smsRemindersEnabled} onCheckedChange={(enabled) => set("smsRemindersEnabled", enabled)} />
              </label>
            </Panel>
          </div>
          <div className="flex flex-wrap justify-between gap-2 border-t pt-3">
            <Button type="button" variant="outline" onClick={() => exportAudit.mutate(undefined)} disabled={exportAudit.isPending}>
              {exportAudit.isPending ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" />}
              Download Audit Logs
            </Button>
            <Button type="submit" size="sm" disabled={save.isPending}>
              {save.isPending && <Spinner className="h-4 w-4 text-current" />} Save settings
            </Button>
          </div>
        </form>
      </TabsContent>
      <TabsContent value="backup" className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Panel className="space-y-3 p-3">
            <SectionTitle title="Create a backup" compact />
            <p className="text-sm text-muted-foreground">Download a copy of the current hotel data.</p>
            <Button size="sm" onClick={() => createBackup.mutate(undefined)} disabled={createBackup.isPending}>
              {createBackup.isPending ? <Spinner className="h-4 w-4 text-current" /> : <DatabaseBackup className="h-4 w-4" />}
              Create &amp; download
            </Button>
          </Panel>
          <Panel className="space-y-3 p-3">
            <SectionTitle title="Restore from a file" compact />
            {USE_DEMO_BACKEND ? (
              <>
                <p className="text-sm text-muted-foreground">Restoring replaces all current demo records.</p>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  aria-label="Backup file"
                  onChange={(event) => void readBackupFile(event.target.files?.[0])}
                />
                <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={restore.isPending}>
                  {restore.isPending ? <Spinner className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
                  Choose backup file
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Live database restore is server-only and requires an empty target database. This protects current records from accidental replacement.
              </p>
            )}
          </Panel>
        </div>
        <section>
          <SectionTitle title="Backup history" compact />
          {backupsQuery.isPending ? (
            <LoadingBlock label="Loading backup history…" />
          ) : backupsQuery.isError ? (
            <ErrorState error={backupsQuery.error} onRetry={() => void backupsQuery.refetch()} />
          ) : !backupsQuery.data?.length ? (
            <EmptyState title="No backups yet" description="Create a backup above." />
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Created</TableHead>
                    <TableHead>Created by</TableHead>
                    <TableHead className="text-right">Size</TableHead>
                    {!USE_DEMO_BACKEND && <TableHead className="w-12" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {backupsQuery.data.map((backup) => (
                    <TableRow key={backup.id}>
                      <TableCell className="whitespace-nowrap">{dateTime(backup.createdAt)}</TableCell>
                      <TableCell>{backup.createdBy}</TableCell>
                      <TableCell className="text-right tabular-nums">{backup.sizeKb.toLocaleString()} KB</TableCell>
                      {!USE_DEMO_BACKEND && (
                        <TableCell>
                          <Button size="sm" variant="outline" onClick={() => downloadBackup.mutate(backup)} disabled={downloadBackup.isPending} aria-label={`Download backup created ${dateTime(backup.createdAt)}`}>
                            <Download className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      </TabsContent>
      <ConfirmDialog
        open={Boolean(pendingRestore)}
        onOpenChange={(open) => !open && setPendingRestore(null)}
        title="Restore this backup?"
        description={
          <span>
            All current demo records will be replaced with <b>{pendingRestore?.name}</b>. This cannot be undone.
          </span>
        }
        confirmLabel="Restore backup"
        onConfirm={() => pendingRestore && restore.mutate(pendingRestore.snapshot)}
      />
    </Tabs>
  );
}
