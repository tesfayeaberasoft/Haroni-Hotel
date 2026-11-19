import { describe, expect, it } from "vitest";
import {
  cashierLimitStatusMessage,
  cashierSafeGuestAccount,
  cashierSafeNote,
  cashierTransactionActionAccess,
} from "./cashier";

describe("cashierLimitStatusMessage", () => {
  it("reports an exceeded limit without revealing credit amounts", () => {
    expect(
      cashierLimitStatusMessage({
        code: "HH-00000001",
        status: "pending_guest",
        exceedsLimit: true,
      }),
    ).toBe(
      "HH-00000001 sent to the guest to confirm. Credit limit exceeded; exceptional Finance approval will be required.",
    );
  });

  describe("cashierTransactionActionAccess", () => {
    const cashier = { fullName: "Cashier One", username: "cashier1" };

    it.each(["draft", "disputed", "pending_guest", "pending_price_approval"] as const)(
      "allows the creating cashier to correct and cancel %s transactions",
      (status) => {
        expect(
          cashierTransactionActionAccess({ createdBy: cashier.fullName, status }, cashier, false),
        ).toMatchObject({ showSection: true, isOwner: true, canCorrect: true, canCancel: true });
      },
    );

    it("allows cancellation of expired transactions only in the demo workflow", () => {
      const tx = { createdBy: cashier.username, status: "expired" as const };
      expect(cashierTransactionActionAccess(tx, cashier, true)).toMatchObject({
        showSection: true,
        isOwner: true,
        canCorrect: false,
        canCancel: true,
      });
      expect(cashierTransactionActionAccess(tx, cashier, false)).toMatchObject({
        showSection: true,
        isOwner: true,
        canCorrect: false,
        canCancel: false,
      });
    });

    it("does not offer actions to a cashier who did not create the transaction", () => {
      expect(
        cashierTransactionActionAccess(
          { createdBy: "Someone Else", status: "pending_guest" },
          cashier,
          false,
        ),
      ).toMatchObject({ showSection: true, isOwner: false, canCorrect: false, canCancel: false });
    });
  });

  describe("cashierSafeNote", () => {
    it("hides audit notes containing account credit details from cashiers", () => {
      expect(cashierSafeNote("Exceeds available credit by 500 ETB", false)).toBe(
        "Credit-related account details are hidden from cashiers.",
      );
    });

    it("preserves service-related audit notes", () => {
      const note = "Removed one duplicated service from this transaction.";
      expect(cashierSafeNote(note, false)).toBe(note);
    });
  });

  describe("cashierSafeGuestAccount", () => {
    it("removes account figures while preserving guest identity", () => {
      const account = cashierSafeGuestAccount({
        id: "guest-1",
        fullName: "Example Guest",
        phone: "555-0100",
        username: "example",
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
        creditLimit: 1000,
        historicalDebt: 100,
        approvedCredit: 200,
        totalPayments: 50,
        outstandingDebt: 250,
        pendingReservations: 75,
        availableCredit: 675,
        exceedsLimit: false,
      });

      expect(account).toMatchObject({
        id: "guest-1",
        fullName: "Example Guest",
        phone: "555-0100",
        creditLimit: 0,
        historicalDebt: 0,
        approvedCredit: 0,
        totalPayments: 0,
        outstandingDebt: 0,
        pendingReservations: 0,
        availableCredit: 0,
        exceedsLimit: false,
      });
    });
  });

  it("reports when the limit is not exceeded", () => {
    expect(
      cashierLimitStatusMessage({
        code: "HH-00000002",
        status: "pending_guest",
        exceedsLimit: false,
      }),
    ).toBe("HH-00000002 sent to the guest to confirm. Credit limit not exceeded.");
  });

  it("defers limit status while a special price is awaiting approval", () => {
    expect(
      cashierLimitStatusMessage({
        code: "HH-00000003",
        status: "pending_price_approval",
        exceedsLimit: false,
      }),
    ).toBe(
      "HH-00000003 sent to Finance for price approval. Credit-limit status will be confirmed after price approval.",
    );
  });
});
