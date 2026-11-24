import type { AccountStatus, StaffUser } from "@/types";
import { USE_DEMO_BACKEND } from "./config";
import { api, ApiError } from "./http";
import { mapPhpAccountStatus, mapPhpRole, phpDate, phpRow, phpRows, phpText } from "./php-mappers";

export interface StaffInput {
  fullName: string;
  username: string;
  phone: string;
  role: StaffUser["role"];
  password?: string | undefined;
}

function mapStaff(value: unknown): StaffUser {
  const row = phpRow(value);
  const role = mapPhpRole(row.role);
  if (role === "guest") throw new ApiError("A guest account was returned in the staff list.", 502);
  return {
    id: phpText(row.id),
    fullName: phpText(row.full_name),
    username: phpText(row.username),
    phone: phpText(row.phone),
    role,
    status: mapPhpAccountStatus(row.is_active),
    createdAt: phpDate(row.created_at),
    ...(row["last_login_at"] ? { lastLoginAt: phpDate(row["last_login_at"]) } : {}),
  };
}

const apiRole = (role: StaffUser["role"]) =>
  role === "admin" ? "system_administrator" : role === "finance" ? "finance_manager" : role;

export const usersService = {
  list: async () => {
    if (USE_DEMO_BACKEND) return api.get<StaffUser[]>("/users");
    const response = await api.get<{ users: unknown[] }>("/users");
    return phpRows(response.users).filter((row) => row.role !== "guest").map(mapStaff);
  },
  create: async (input: StaffInput) => {
    if (USE_DEMO_BACKEND) return api.post<StaffUser>("/users", input);
    if (input.role === "admin") throw new ApiError("The PHP backend does not allow creating additional System Administrator accounts.", 422);
    if (!input.password || input.password.length < 12 || input.password.length > 72) {
      throw new ApiError("Passwords must contain 12 to 72 characters.", 422);
    }
    const response = await api.post<{ id: number }>("/users", {
      full_name: input.fullName,
      username: input.username,
      phone: input.phone,
      role: apiRole(input.role),
      password: input.password,
    });
    return {
      id: String(response.id),
      fullName: input.fullName,
      username: input.username,
      phone: input.phone,
      role: input.role,
      status: "active",
      createdAt: new Date().toISOString(),
    } satisfies StaffUser;
  },
  update: async (id: string, input: Partial<StaffInput>) => {
    if (USE_DEMO_BACKEND) return api.put<StaffUser>(`/users/${id}`, input);
    await api.post(`/users/${id}/profile`, {
      ...(input.fullName !== undefined ? { full_name: input.fullName } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.username !== undefined ? { username: input.username } : {}),
      ...(input.role !== undefined ? { role: apiRole(input.role) } : {}),
    });
    return usersService.list().then((users) => {
      const updated = users.find((user) => user.id === id);
      if (!updated) throw new ApiError("Updated user was not returned by the server.", 502);
      return updated;
    });
  },
  setStatus: async (id: string, status: AccountStatus) => {
    if (USE_DEMO_BACKEND) return api.post<StaffUser>(`/users/${id}/status`, { status });
    if (status === "suspended") throw new ApiError("The PHP backend supports active and inactive accounts, not suspension.", 422);
    await api.post(`/users/${id}/status`, { active: status === "active" });
    const updated = (await usersService.list()).find((user) => user.id === id);
    if (!updated) throw new ApiError("Updated user was not returned by the server.", 502);
    return updated;
  },
  resetPassword: async (id: string, newPassword: string) => {
    if (USE_DEMO_BACKEND) return api.post<{ ok: true }>(`/users/${id}/reset-password`, { newPassword });
    void newPassword;
    const response = await api.post<{ temporary_password: string }>(`/users/${id}/password`);
    return { temporaryPassword: response.temporary_password };
  },
};
