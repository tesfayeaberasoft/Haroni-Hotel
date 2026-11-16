// Demo mode is opt-in. A failed live API request never switches to local sample data.
const rawBase = (import.meta.env["VITE_API_BASE_URL"] as string | undefined) ?? "/api";

export const API_BASE_URL = rawBase.replace(/\/+$/, "");
export const USE_DEMO_BACKEND = import.meta.env["VITE_USE_DEMO_BACKEND"] === "true";
export const SESSION_STORAGE_KEY = "haroni-dcms-session";
