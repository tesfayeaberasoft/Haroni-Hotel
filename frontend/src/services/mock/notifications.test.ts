import { beforeEach, describe, expect, it } from "vitest";
import type { AuthSession, Notification } from "@/types";
import { writeSession } from "../session";
import { db, setMemoryState } from "./db";
import { demoRequest } from "./handlers";
import { buildSeed } from "./seed";

async function loginAsGuest() {
  writeSession(null);
  const session = await demoRequest<AuthSession>("POST", "/auth/login", {
    username: "abebe",
    password: "guest123",
  });
  writeSession(session);
}

describe("guest notification management", () => {
  beforeEach(() => setMemoryState(buildSeed()));

  it("deletes one notification and prevents deleting another guest's notification", async () => {
    db().notifications["g-02"] = [
      { id: "n-other", at: new Date().toISOString(), title: "Other", body: "Other guest", read: false },
    ];
    await loginAsGuest();

    await demoRequest("POST", "/me/notifications/n-1/delete");

    const remaining = await demoRequest<Notification[]>("GET", "/me/notifications");
    expect(remaining.map((notification) => notification.id)).toEqual(["n-2"]);
    await expect(demoRequest("POST", "/me/notifications/n-other/delete")).rejects.toThrow(/not found/i);
    expect(db().notifications["g-02"]).toHaveLength(1);
  });

  it("clears only the signed-in guest's notifications", async () => {
    db().notifications["g-02"] = [
      { id: "n-other", at: new Date().toISOString(), title: "Other", body: "Other guest", read: false },
    ];
    await loginAsGuest();

    await demoRequest("POST", "/me/notifications/clear");

    expect(await demoRequest<Notification[]>("GET", "/me/notifications")).toEqual([]);
    expect(db().notifications["g-02"]).toHaveLength(1);
  });
});
