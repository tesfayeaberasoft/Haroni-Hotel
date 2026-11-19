import type {
  AccountStatus,
  CreditLimitChange,
  CreditTransaction,
  Guest,
  GuestAccount,
  HistoricalDebt,
  Payment,
} from "@/types";
import { USE_DEMO_BACKEND } from "./config";
import { api, ApiError } from "./http";
import {
  mapPhpAccount,
  mapPhpGuest,
  mapPhpHistorical,
  mapPhpPayment,
  mapPhpTransaction,
  phpNumber,
  phpRow,
  phpRows,
  phpText,
  type PhpRow,
} from "./php-mappers";
import { readSession } from "./session";
import { cashierSafeGuestAccount } from "@/lib/cashier";

export interface GuestInput {
  fullName: string;
  phone: string;
  username: string;
  password: string;
  pin: string;
}

export interface GuestDetail {
  account: GuestAccount;
  transactions: CreditTransaction[];
  payments?: Payment[] | undefined;
  historical?: HistoricalDebt[] | undefined;
  limitChanges?: CreditLimitChange[] | undefined;
}

function cashierSafe(account: GuestAccount) {
  return readSession()?.user.role === "cashier" ? cashierSafeGuestAccount(account) : account;
}

export const guestsService = {
  search: async (search?: string, status?: AccountStatus) => {
    if (USE_DEMO_BACKEND) {
      const accounts = await api.get<GuestAccount[]>("/guests", { search, status });
      return accounts.map(cashierSafe);
    }
    const response = await api.get<{ guests: unknown[] }>("/guests", { q: search });
    return phpRows(response.guests).map(mapPhpAccount).filter((guest) => !status || guest.status === status).map(cashierSafe);
  },
  listBasic: async () => {
    if (USE_DEMO_BACKEND) return api.get<Guest[]>("/guests");
    const response = await api.get<{ users: unknown[] }>("/users");
    return phpRows(response.users).filter((row) => row.role === "guest").map(mapPhpGuest);
  },
  detail: async (id: string) => {
    if (USE_DEMO_BACKEND) return api.get<GuestDetail>(`/guests/${id}`);
    const [accountResponse, statementResponse, transactionResponse, paymentResponse, historicalResponse] = await Promise.all([
      api.get<Record<string, unknown>>(`/credit-account/${id}`),
      api.get<Record<string, unknown>>(`/guests/${id}/statement`),
      api.get<{ transactions: unknown[] }>("/transactions"),
      api.get<{ payments: unknown[] }>("/payments"),
      api.get<{ opening_balances: unknown[] }>("/historical-debts"),
    ]);
    const statement = phpRow(statementResponse);
    return {
      account: mapPhpAccount(accountResponse),
      transactions: phpRows(transactionResponse.transactions)
        .filter((row) => String(row.guest_id) === id)
        .map(mapPhpTransaction),
      payments: phpRows(paymentResponse.payments)
        .filter((row) => String(row.guest_id) === id)
        .map(mapPhpPayment),
      historical: phpRows(historicalResponse.opening_balances)
        .filter((row) => String(row.guest_id) === id)
        .map(mapPhpHistorical),
      limitChanges: [],
      ...("ledger" in statement ? {} : {}),
    };
  },
  create: async (input: GuestInput) => {
    if (USE_DEMO_BACKEND) return api.post<Guest>("/guests", input);
    if (input.password.length < 12 || input.password.length > 72) {
      throw new ApiError("Passwords must contain 12 to 72 characters.", 422);
    }
    const response = await api.post<{ id: number }>("/users", {
      username: input.username,
      password: input.password,
      role: "guest",
      full_name: input.fullName,
      phone: input.phone,
    });
    return {
      id: String(response.id),
      fullName: input.fullName,
      phone: input.phone,
      username: input.username,
      status: "active",
      creditLimit: 0,
      createdAt: new Date().toISOString(),
    } satisfies Guest;
  },
  update: async (id: string, input: Partial<Omit<GuestInput, "username" | "password">>) => {
    if (USE_DEMO_BACKEND) return api.put<Guest>(`/guests/${id}`, input);
    if (input.pin) throw new ApiError("Guests set their own confirmation PIN after signing in.", 422);
    const profile: Record<string, string> = {};
    if (input.fullName !== undefined) profile["full_name"] = input.fullName;
    if (input.phone !== undefined) profile["phone"] = input.phone;
    await api.post(`/users/${id}/profile`, profile);
    const guest = (await guestsService.listBasic()).find((value) => value.id === id);
    if (!guest) throw new ApiError("Updated guest was not returned by the server.", 502);
    return guest;
  },
  setStatus: async (id: string, status: AccountStatus) => {
    if (USE_DEMO_BACKEND) return api.post<Guest>(`/guests/${id}/status`, { status });
    if (status === "suspended") throw new ApiError("The PHP backend supports active and inactive guest accounts, not suspension.", 422);
    await api.post(`/users/${id}/status`, { active: status === "active" });
    const guest = (await guestsService.listBasic()).find((value) => value.id === id);
    if (!guest) throw new ApiError("Updated guest was not returned by the server.", 502);
    return guest;
  },
  resetPassword: async (id: string, newPassword: string) => {
    if (USE_DEMO_BACKEND) return api.post<{ ok: true }>(`/users/${id}/reset-password`, { newPassword });
    void newPassword;
    const response = await api.post<{ temporary_password: string }>(`/users/${id}/password`);
    return { temporaryPassword: response.temporary_password };
  },
  setCreditLimit: async (id: string, creditLimit: number, reason: string) => {
    if (USE_DEMO_BACKEND) return api.post<GuestAccount>(`/guests/${id}/credit-limit`, { creditLimit, reason });
    void reason;
    await api.post(`/guests/${id}/credit-limit`, { credit_limit: creditLimit.toFixed(2) });
    return mapPhpAccount(await api.get<Record<string, unknown>>(`/credit-account/${id}`));
  },
  limitHistory: async () => {
    if (USE_DEMO_BACKEND) return api.get<CreditLimitChange[]>("/credit-limits/history");
    const response = await api.get<{ audit_logs: unknown[] }>("/audit-logs");
    return phpRows(response.audit_logs).flatMap((row) => {
      if (row.action !== "credit_limit_updated") return [];
      let details: PhpRow = {};
      try {
        details = phpRow(JSON.parse(phpText(row.details)));
      } catch {
        return [];
      }
      return [{
        id: phpText(row.id),
        guestId: phpText(row.entity_id),
        guestName: phpText(details.full_name),
        previousLimit: phpNumber(details.previous_credit_limit),
        newLimit: phpNumber(details.new_credit_limit),
        reason: "",
        changedBy: phpText(row.actor),
        changedAt: phpText(row.created_at),
      }];
    });
  },
};
