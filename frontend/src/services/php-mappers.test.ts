import { describe, expect, it } from "vitest";
import { mapPhpPriceRequest, mapPhpTransaction } from "./php-mappers";

describe("PHP transaction price request mapping", () => {
  it("maps pending special-price lines and transaction approval requests", () => {
    const transaction = mapPhpTransaction({
      id: 39,
      guest_id: 17,
      guest_name: "Abebe Kebede",
      cashier_username: "dawit",
      consumption_date: "2026-11-14",
      created_at: "2026-11-14 06:16:00",
      status: "pending_price_approval",
      total_amount: "600.00",
      requires_exception: 0,
      items: [
        {
          service_id: 3,
          service_name: "Breakfast Buffet",
          quantity: "1.000",
          unit_price: "600.00",
          catalog_price: "650.00",
          line_total: "600.00",
          requested_price: "600.00",
          price_reason: "Returning guest rate",
          price_status: "pending",
        },
      ],
    });

    expect(transaction.status).toBe("pending_price_approval");
    expect(transaction.items[0]).toMatchObject({
      serviceName: "Breakfast Buffet",
      unitPrice: 600,
      catalogPrice: 650,
      priceRequest: {
        requestedPrice: 600,
        reason: "Returning guest rate",
        status: "pending",
      },
    });

    expect(mapPhpPriceRequest({
      id: "transaction-71",
      request_kind: "transaction",
      transaction_id: 39,
      transaction_code: "HH-00000039",
      service_id: 3,
      service_name: "Breakfast Buffet",
      current_price: "650.00",
      proposed_price: "600.00",
      reason: "Returning guest rate",
      requester: "dawit",
      created_at: "2026-11-14 06:16:00",
      status: "pending",
    })).toMatchObject({
      id: "transaction-71",
      kind: "transaction",
      transactionId: "39",
      transactionCode: "HH-00000039",
      currentPrice: 650,
      requestedPrice: 600,
      status: "pending",
    });
  });
});
