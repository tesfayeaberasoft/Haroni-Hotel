import type { CreditTransaction, GuestAccount, TransactionStatus } from "@/types";
import { USE_DEMO_BACKEND } from "./config";
import { api, ApiError } from "./http";
import { mapPhpAccount, mapPhpTransaction, phpRows, toPhpTransactionStatus } from "./php-mappers";
import { readSession } from "./session";

export interface TransactionLineInput {
  serviceId: string;
  quantity: number;
  /** Accepted only by the demo backend; the PHP backend always uses approved catalog prices. */
  requestedPrice?: number | undefined;
  priceReason?: string | undefined;
}

export interface TransactionInput {
  guestId: string;
  consumptionDate: string;
  items: TransactionLineInput[];
  note?: string | undefined;
}

export interface TransactionFilter {
  status?: TransactionStatus | TransactionStatus[] | undefined;
  guestId?: string | undefined;
  search?: string | undefined;
}

function phpItems(items: TransactionLineInput[]) {
  return items.map(({ serviceId, quantity, requestedPrice, priceReason }) => ({
    service_id: Number(serviceId),
    quantity,
    ...(requestedPrice !== undefined
      ? { requested_price: requestedPrice.toFixed(2), price_reason: priceReason ?? "" }
      : {}),
  }));
}

async function load(id: string) {
  const response = await api.get<{ transaction: Record<string, unknown> }>(`/transactions/${id}`);
  return mapPhpTransaction(response.transaction);
}

async function updateAndLoad(id: string, action: () => Promise<unknown>) {
  await action();
  return load(id);
}

export const transactionsService = {
  list: async (filter: TransactionFilter = {}) => {
    if (USE_DEMO_BACKEND) {
      return api.get<CreditTransaction[]>("/transactions", {
        status: Array.isArray(filter.status) ? filter.status.join(",") : filter.status,
        guestId: filter.guestId,
        search: filter.search,
      });
    }
    const statuses =
      filter.status === undefined
        ? [undefined]
        : Array.isArray(filter.status)
          ? filter.status
          : [filter.status];
    const responses = await Promise.all(
      statuses.map((status) =>
        api.get<{ transactions: unknown[] }>(
          "/transactions",
          status ? { status: toPhpTransactionStatus(status) } : undefined,
        ),
      ),
    );
    const rows = new Map<string, CreditTransaction>();
    for (const response of responses) {
      for (const transaction of phpRows(response.transactions).map(mapPhpTransaction)) {
        if (!filter.guestId || transaction.guestId === filter.guestId)
          rows.set(transaction.id, transaction);
      }
    }
    return [...rows.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  get: async (id: string) => {
    if (USE_DEMO_BACKEND) {
      const result = await api.get<{ transaction: CreditTransaction; account?: GuestAccount }>(
        `/transactions/${id}`,
      );
      return readSession()?.user.role === "cashier" ? { transaction: result.transaction } : result;
    }
    const transaction = await load(id);
    const role = readSession()?.user.role;
    if (role === "guest" || role === "cashier") return { transaction };
    const account = mapPhpAccount(
      await api.get<Record<string, unknown>>(`/credit-account/${transaction.guestId}`),
    );
    return { transaction, account };
  },
  create: async (input: TransactionInput) => {
    if (USE_DEMO_BACKEND) return api.post<CreditTransaction>("/transactions", input);
    const created = await api.post<{ id: number }>("/transactions", {
      guest_id: Number(input.guestId),
      consumption_date: input.consumptionDate.slice(0, 10),
      items: phpItems(input.items),
    });
    await api.post(`/transactions/${created.id}/submit`);
    return load(String(created.id));
  },
  updateDraft: async (id: string, input: Omit<TransactionInput, "guestId">) => {
    if (USE_DEMO_BACKEND) {
      return api.post<CreditTransaction>(`/transactions/${id}/draft`, {
        items: input.items,
        consumptionDate: input.consumptionDate,
      });
    }
    return updateAndLoad(id, () =>
      api.post(`/transactions/${id}/draft`, {
        items: phpItems(input.items),
        consumption_date: input.consumptionDate.slice(0, 10),
      }),
    );
  },
  correct: async (id: string, input: Omit<TransactionInput, "guestId">) => {
    if (USE_DEMO_BACKEND) return api.put<CreditTransaction>(`/transactions/${id}`, input);
    return updateAndLoad(id, () =>
      api.post(`/transactions/${id}/resubmit`, {
        items: phpItems(input.items),
        consumption_date: input.consumptionDate.slice(0, 10),
        ...(input.note === undefined ? {} : { note: input.note }),
      }),
    );
  },
  confirm: async (id: string) => {
    if (USE_DEMO_BACKEND) return api.post<CreditTransaction>(`/transactions/${id}/confirm`);
    return updateAndLoad(id, () => api.post(`/transactions/${id}/confirm`));
  },
  dispute: async (id: string, reason: string) => {
    if (USE_DEMO_BACKEND)
      return api.post<CreditTransaction>(`/transactions/${id}/dispute`, { reason });
    return updateAndLoad(id, () => api.post(`/transactions/${id}/dispute`, { reason }));
  },
  sendOtp: async (id: string) => {
    if (USE_DEMO_BACKEND)
      return api.post<{ sentTo: string; demoCode?: string }>(`/transactions/${id}/send-otp`);
    throw new ApiError(
      "The live backend has no SMS/OTP gateway; use the guest's in-person confirmation PIN.",
      501,
    );
  },
  confirmInHotel: async (id: string, method: "pin" | "otp", code: string) => {
    if (USE_DEMO_BACKEND)
      return api.post<CreditTransaction>(`/transactions/${id}/confirm-in-hotel`, { method, code });
    if (method !== "pin")
      throw new ApiError(
        "OTP confirmation is unavailable because no SMS gateway is configured.",
        501,
      );
    const transaction = await load(id);
    await api.post("/transactions/confirm-in-person", {
      transaction_id: Number(id),
      guest_id: Number(transaction.guestId),
      pin: code,
    });
    return load(id);
  },
  cancel: async (id: string, reason: string) => {
    if (USE_DEMO_BACKEND)
      return api.post<CreditTransaction>(`/transactions/${id}/cancel`, { reason });
    return updateAndLoad(id, () => api.post(`/transactions/${id}/cancel`, { reason }));
  },
  approve: async (id: string, reason?: string) => {
    if (USE_DEMO_BACKEND)
      return api.post<CreditTransaction>(`/transactions/${id}/approve`, { reason });
    return updateAndLoad(id, () =>
      api.post(`/transactions/${id}/approve`, reason ? { exception_reason: reason } : {}),
    );
  },
  reject: async (id: string, reason: string) => {
    if (USE_DEMO_BACKEND)
      return api.post<CreditTransaction>(`/transactions/${id}/reject`, { reason });
    return updateAndLoad(id, () => api.post(`/transactions/${id}/reject`, { reason }));
  },
};
