import { describe, expect, it } from "vitest";
import { db, setMemoryState } from "./db";
import { buildSeed, type DemoState } from "./seed";

describe("demo database cross-tab synchronization", () => {
  it("uses payment updates received from another browser tab", () => {
    const stale = buildSeed();
    stale.payments[0]!.verified = false;
    setMemoryState(stale);
    db();

    const updated = JSON.parse(JSON.stringify(stale)) as DemoState;
    updated.payments[0]!.verified = true;
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "haroni-dcms-demo-db",
        newValue: JSON.stringify(updated),
      }),
    );

    expect(db().payments[0]!.verified).toBe(true);
  });
});
