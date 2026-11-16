import type { AuthSession } from "@/types";
import { SESSION_STORAGE_KEY } from "./config";

export const UNAUTHORIZED_EVENT = "dcms:unauthorized";
let inMemorySession: AuthSession | null = null;

export function readSession(): AuthSession | null {
  if (typeof window === "undefined") return inMemorySession;
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    inMemorySession = raw ? (JSON.parse(raw) as AuthSession) : null;
  } catch {
    return inMemorySession;
  }
  return inMemorySession;
}

export function writeSession(session: AuthSession | null) {
  inMemorySession = session;
  if (typeof window === "undefined") return;
  try {
    if (session) window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Keep the active session in memory when browser storage is unavailable.
  }
}
