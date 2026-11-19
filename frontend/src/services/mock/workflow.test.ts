import { beforeEach, describe, expect, it } from "vitest";
import type { AuthSession, CreditTransaction, GuestAccount, Payment } from "@/types";
import { writeSession } from "../session";
import { db, setMemoryState } from "./db";
import { demoRequest } from "./handlers";
import { buildSeed } from "./seed";

async function loginAs(username: string, password: string) {
  writeSession(null);
  const s = await demoRequest<AuthSession>("POST", "/auth/login", { username, password });
  writeSession(s);
  return s;
}
const account = async () => {
  await loginAs("finance", "finance123");
  const d = await demoRequest<{ account: GuestAccount }>("GET", "/guests/g-01");
  return d.account;
};

describe("credit transaction workflow (SRS 2.1, 2.3)", () => {
  beforeEach(() => setMemoryState(buildSeed()));

  it("debt only increases after Finance approval", async () => {
    const before = await account();
    await loginAs("cashier", "cashier123");
    const tx = await demoRequest<CreditTransaction>("POST", "/transactions", {
      guestId: "g-01",
      items: [{ serviceId: "s-02", quantity: 2 }],
    });
    expect(tx.status).toBe("pending_guest");
    expect(tx.total).toBe(1_700);

    await loginAs("abebe", "guest123");
    const confirmed = await demoRequest<CreditTransaction>(
      "POST",
      `/transactions/${tx.id}/confirm`,
    );
    expect(confirmed.status).toBe("pending_finance");
    expect((await account()).outstandingDebt).toBe(before.outstandingDebt);

    await demoRequest("POST", `/transactions/${tx.id}/approve`);
    expect((await account()).outstandingDebt).toBe(before.outstandingDebt + 1_700);
  });

  it("a dispute needs a written reason and returns the transaction to the cashier", async () => {
    await loginAs("cashier", "cashier123");
    const tx = await demoRequest<CreditTransaction>("POST", "/transactions", {
      guestId: "g-01",
      items: [{ serviceId: "s-07", quantity: 1 }],
    });
    await loginAs("abebe", "guest123");
    await expect(
      demoRequest("POST", `/transactions/${tx.id}/dispute`, { reason: "" }),
    ).rejects.toThrow(/reason/);
    const d = await demoRequest<CreditTransaction>("POST", `/transactions/${tx.id}/dispute`, {
      reason: "I did not order this.",
    });
    expect(d.status).toBe("disputed");
    await expect(demoRequest("POST", `/transactions/${tx.id}/confirm`)).rejects.toThrow();
  });

  it("confirms a pending guest with a PIN without sending an OTP and blocks duplicates", async () => {
    await loginAs("cashier", "cashier123");
    const tx = await demoRequest<CreditTransaction>("POST", "/transactions", {
      guestId: "g-01",
      items: [{ serviceId: "s-02", quantity: 1 }],
    });
    const guestPin = db().guests.find((guest) => guest.id === "g-01")?.pin;
    expect(guestPin).toBeTruthy();

    const confirmed = await demoRequest<CreditTransaction>(
      "POST",
      `/transactions/${tx.id}/confirm-in-hotel`,
      { method: "pin", code: guestPin },
    );
    expect(confirmed.status).toBe("pending_finance");
    expect(confirmed.confirmation?.method).toBe("pin");
    expect(confirmed.confirmation?.assistedBy).toBe("Dawit Bekele");
    await expect(
      demoRequest("POST", `/transactions/${tx.id}/confirm-in-hotel`, {
        method: "pin",
        code: guestPin,
      }),
    ).rejects.toThrow(/not awaiting confirmation/i);
  });

  it("returns clear errors for a missing PIN or a guest without a configured PIN", async () => {
    await loginAs("cashier", "cashier123");
    const tx = await demoRequest<CreditTransaction>("POST", "/transactions", {
      guestId: "g-01",
      items: [{ serviceId: "s-02", quantity: 1 }],
    });
    await expect(
      demoRequest("POST", `/transactions/${tx.id}/confirm-in-hotel`, {
        method: "pin",
        code: "",
      }),
    ).rejects.toThrow(/enter the guest confirmation PIN/i);

    const guest = db().guests.find((item) => item.id === "g-01");
    expect(guest).toBeDefined();
    guest!.pin = "";
    await expect(
      demoRequest("POST", `/transactions/${tx.id}/confirm-in-hotel`, {
        method: "pin",
        code: "1234",
      }),
    ).rejects.toThrow(/has not set a confirmation PIN/i);
  });

  it("allows Finance Managers and Owners, but not Cashiers or Administrators, to approve", async () => {
    const tx = db().transactions.find((transaction) => transaction.status === "pending_finance");
    expect(tx).toBeDefined();
    await loginAs("cashier", "cashier123");
    await expect(demoRequest("POST", `/transactions/${tx!.id}/approve`)).rejects.toThrow(
      /permission/,
    );
    await loginAs("admin", "admin123");
    await expect(demoRequest("POST", `/transactions/${tx!.id}/approve`)).rejects.toThrow(
      /permission/,
    );
    await loginAs("owner", "owner123");
    const approved = await demoRequest<CreditTransaction>(
      "POST",
      `/transactions/${tx!.id}/approve`,
    );
    expect(approved.status).toBe("approved");
    expect(approved.history.at(-1)?.by).toBe("Hotel Owner");
  });

  it("lets the Owner use cashier workflows and manage owner accounts", async () => {
    const tx = db().transactions[0];
    expect(tx).toBeDefined();
    tx!.status = "draft";
    tx!.createdBy = "Another Cashier";

    await loginAs("owner", "owner123");
    const cashierDashboard = await demoRequest<{ totalRecorded: number }>(
      "GET",
      "/dashboard/cashier",
    );
    expect(cashierDashboard.totalRecorded).toBe(db().transactions.length);

    const updated = await demoRequest<CreditTransaction>("POST", `/transactions/${tx!.id}/draft`, {
      items: [{ serviceId: "s-02", quantity: 1 }],
    });
    expect(updated.status).toBe("draft");
    expect(updated.history.at(-1)?.by).toBe("Hotel Owner");

    const created = await demoRequest<{ role: string }>("POST", "/users", {
      fullName: "Additional Owner",
      username: "additional-owner",
      password: "ownerpass123",
      role: "owner",
    });
    expect(created.role).toBe("owner");
  });

  it("prevents Finance Managers from creating Owner accounts", async () => {
    await loginAs("finance", "finance123");
    await expect(
      demoRequest("POST", "/users", {
        fullName: "Unauthorized Owner",
        username: "unauthorized-owner",
        password: "ownerpass123",
        role: "owner",
      }),
    ).rejects.toThrow(/Only Owners or System Administrators/i);
  });

  it("transactions over available credit need an exceptional approval with a reason", async () => {
    await loginAs("cashier", "cashier123");
    const tx = await demoRequest<CreditTransaction>("POST", "/transactions", {
      guestId: "g-01",
      items: [{ serviceId: "s-18", quantity: 20 }],
    });
    expect(tx.exceedsLimit).toBe(true);
    await loginAs("abebe", "guest123");
    const c = await demoRequest<CreditTransaction>("POST", `/transactions/${tx.id}/confirm`);
    expect(c.status).toBe("pending_exception");
    await loginAs("finance", "finance123");
    await expect(demoRequest("POST", `/transactions/${tx.id}/approve`, {})).rejects.toThrow(
      /reason/,
    );
    const a = await demoRequest<CreditTransaction>("POST", `/transactions/${tx.id}/approve`, {
      reason: "Long-standing guest, CFO approved.",
    });
    expect(a.exceptionApproval?.approvedBy).toBe("Meron Alemu");
  });

  it("partial payments reduce outstanding debt by the paid amount", async () => {
    const before = await account();
    const p = await demoRequest<Payment>("POST", "/payments", {
      guestId: "g-01",
      amount: 8_000,
      method: "cash",
      verified: true,
    });
    expect(p.balanceAfter).toBe(before.outstandingDebt - 8_000);
    expect((await account()).outstandingDebt).toBe(before.outstandingDebt - 8_000);
  });

  it("special prices block submission to the guest until Finance approves", async () => {
    await loginAs("cashier", "cashier123");
    const tx = await demoRequest<CreditTransaction>("POST", "/transactions", {
      guestId: "g-01",
      items: [
        { serviceId: "s-13", quantity: 1, requestedPrice: 4_000, priceReason: "Weekend promotion" },
      ],
    });
    expect(tx.status).toBe("pending_price_approval");
  });

  it("allows the creating cashier to update and cancel a draft transaction", async () => {
    const cashier = await loginAs("cashier", "cashier123");
    const tx = db().transactions[0];
    expect(tx).toBeDefined();
    tx!.status = "draft";
    tx!.createdBy = cashier.user.fullName;

    const updated = await demoRequest<CreditTransaction>("POST", `/transactions/${tx!.id}/draft`, {
      items: [{ serviceId: "s-02", quantity: 2 }],
      consumptionDate: "2026-01-10T12:00:00.000Z",
    });
    expect(updated.status).toBe("draft");
    expect(updated.total).toBe(1_700);

    const cancelled = await demoRequest<CreditTransaction>(
      "POST",
      `/transactions/${tx!.id}/cancel`,
      { reason: "Duplicate draft" },
    );
    expect(cancelled.status).toBe("cancelled");
  });
});
