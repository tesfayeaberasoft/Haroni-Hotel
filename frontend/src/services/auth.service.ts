import type { AuthSession, AuthUser, Role } from "@/types";
import { USE_DEMO_BACKEND } from "./config";
import { api, ApiError } from "./http";
import { readSession, writeSession } from "./session";

type PhpUser = {
  id: number | string;
  username: string;
  full_name: string;
  role: "system_administrator" | "owner" | "cashier" | "finance_manager" | "guest";
  phone?: string | null;
  is_active?: boolean;
  must_change_password?: boolean;
  csrf_token?: string;
};

function mapUser(user: PhpUser): AuthUser {
  const roles: Record<PhpUser["role"], Role> = {
    system_administrator: "admin",
    owner: "owner",
    cashier: "cashier",
    finance_manager: "finance",
    guest: "guest",
  };
  const mapped: AuthUser = {
    id: String(user.id),
    role: roles[user.role],
    fullName: user.full_name,
    username: user.username,
    phone: user.phone ?? "",
    status: user.is_active === false ? "inactive" : "active",
  };
  if (user.role === "guest") mapped.guestId = String(user.id);
  return mapped;
}

function mapSession(user: PhpUser, csrfToken = user.csrf_token ?? ""): AuthSession {
  if (!csrfToken) throw new ApiError("The server did not provide a CSRF token. Please sign in again.", 500);
  return { token: csrfToken, csrfToken, user: mapUser(user) };
}

export const authService = {
  login: async (username: string, password: string) => {
    if (USE_DEMO_BACKEND) return api.post<AuthSession>("/auth/login", { username, password });
    const response = await api.post<{ user: PhpUser }>("/login", { username, password });
    return mapSession(response.user);
  },
  current: async () => {
    const response = await api.get<{ user: PhpUser; csrf_token: string }>("/me");
    return mapSession(response.user, response.csrf_token);
  },
  logout: () => USE_DEMO_BACKEND
    ? api.post<{ ok: true }>("/auth/logout")
    : api.post<{ message: string }>("/logout"),
  forgotPassword: async (username: string): Promise<{ message: string }> => {
    if (USE_DEMO_BACKEND) return api.post<{ message: string }>("/auth/forgot-password", { username });
    throw new ApiError("Password reset is handled by the System Administrator. Contact the hotel administrator.", 501);
  },
  changePassword: async (currentPassword: string, newPassword: string) => {
    if (USE_DEMO_BACKEND) {
      return api.post<{ ok: true }>("/auth/change-password", { currentPassword, newPassword });
    }
    const response = await api.post<{ message: string; csrf_token: string }>("/profile/password", {
      current_password: currentPassword,
      new_password: newPassword,
    });
    const session = readSession();
    if (session) {
      const updated = { ...session, token: response.csrf_token, csrfToken: response.csrf_token };
      writeSession(updated);
    }
    return { ok: true as const };
  },
  setConfirmationPin: (pin: string, currentPassword: string) =>
    api.post<{ message: string }>("/profile/confirmation-pin", { pin, current_password: currentPassword }),
};
