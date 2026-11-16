import type { AuditLog, SystemSettings } from "@/types";
import { USE_DEMO_BACKEND } from "./config";
import { api, ApiError } from "./http";
import { phpDate, phpNumber, phpRow, phpRows, phpText, type PhpRow } from "./php-mappers";

export interface BackupInfo {
  id: string;
  createdAt: string;
  createdBy: string;
  sizeKb: number;
}

export interface BackupCreation {
  backup: BackupInfo;
  snapshot?: unknown;
}

function mapBackup(value: PhpRow): BackupInfo {
  const sizeBytes = phpNumber(value.size_bytes);
  return {
    id: phpText(value.filename ?? value.id),
    createdAt: phpDate(value.created_at),
    createdBy: phpText(value.created_by, "Server"),
    sizeKb: Math.ceil(sizeBytes / 1024),
  };
}

function mapSettings(value: PhpRow): SystemSettings {
  return {
    hotelName: phpText(value.hotel_name),
    hotelAddress: phpText(value.hotel_address),
    hotelPhone: phpText(value.hotel_phone),
    hotelEmail: phpText(value.hotel_email),
    hotelTin: phpText(value.hotel_tin),
    currency: phpText(value.currency),
    confirmationDeadlineHours: phpNumber(value.confirmation_deadline_hours),
    reminderBeforeHours: phpNumber(value.reminder_before_hours),
    historicalDebtTarget: phpNumber(value.historical_debt_expected_total),
    receiptFooter: phpText(value.receipt_footer),
    smsRemindersEnabled: phpText(value.sms_reminders_enabled) === "1",
  };
}

export const systemService = {
  settings: async () => {
    if (USE_DEMO_BACKEND) return api.get<SystemSettings>("/settings");
    const response = await api.get<{ settings: PhpRow }>("/system-settings");
    return mapSettings(phpRow(response.settings));
  },
  updateSettings: async (settings: Partial<SystemSettings>) => {
    if (USE_DEMO_BACKEND) return api.put<SystemSettings>("/settings", settings);
    const current = await systemService.settings();
    const next = { ...current, ...settings };
    await api.post("/system-settings", {
      hotel_name: next.hotelName,
      hotel_address: next.hotelAddress,
      hotel_phone: next.hotelPhone,
      hotel_email: next.hotelEmail,
      hotel_tin: next.hotelTin,
      confirmation_deadline_hours: next.confirmationDeadlineHours,
      reminder_before_hours: next.reminderBeforeHours,
      historical_debt_expected_total: next.historicalDebtTarget.toFixed(2),
      receipt_footer: next.receiptFooter,
      sms_reminders_enabled: next.smsRemindersEnabled,
    });
    return systemService.settings();
  },
  auditLogs: async (category?: string, search?: string) => {
    if (USE_DEMO_BACKEND) return api.get<AuditLog[]>("/audit-logs", { category, search });
    const response = await api.get<{ audit_logs: unknown[] }>("/audit-logs");
    const categoryMap: Record<string, AuditLog["category"]> = {
      authentication: "auth",
      user: "user",
      guest_account: "guest",
      credit_transaction: "transaction",
      payment: "payment",
      opening_balance: "historical",
      financial_adjustment: "credit",
      service_catalog: "catalog",
      service_category: "catalog",
      system_setting: "settings",
    };
    return phpRows(response.audit_logs)
      .map((row) => ({
        id: phpText(row.id),
        at: phpDate(row.created_at),
        actor: phpText(row.actor),
        role: "system" as const,
        category: categoryMap[phpText(row.entity_type)] ?? "auth",
        action: phpText(row.action),
        details: phpText(row.details),
      }))
      .filter((entry) => !category || entry.category === category)
      .filter((entry) => !search || `${entry.actor} ${entry.action} ${entry.details}`.toLowerCase().includes(search.toLowerCase()));
  },
  backups: async () => {
    if (USE_DEMO_BACKEND) return api.get<BackupInfo[]>("/backups");
    const response = await api.get<{ backups: unknown[] }>("/backups");
    return phpRows(response.backups).map(mapBackup);
  },
  createBackup: async (): Promise<BackupCreation> => {
    if (USE_DEMO_BACKEND) return api.post<{ backup: BackupInfo; snapshot: unknown }>("/backups");
    const response = await api.post<{ backup: PhpRow }>("/backups");
    return { backup: mapBackup(phpRow(response.backup)) };
  },
  downloadBackup: async (filename: string) => {
    if (USE_DEMO_BACKEND) {
      throw new ApiError("Download an individual backup file from the live database page.", 501);
    }
    await api.download(`/backups/${encodeURIComponent(filename)}`);
  },
  restore: async (snapshot: unknown) => {
    if (USE_DEMO_BACKEND) return api.post<{ ok: true }>("/backups/restore", { snapshot });
    void snapshot;
    throw new ApiError("Live database restore is CLI-only. Use backend/bin/restore-database.php on the server.", 501);
  },
};
