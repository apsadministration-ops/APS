import assert from "node:assert/strict";
import { test } from "node:test";
import { tipRefundableWhere } from "./tipState";

test("runtime refund SQL guard includes recoverable failed tips", async () => {
  // Importing the DB package only builds SQL here; this test never opens a
  // connection or executes a query.
  process.env.DATABASE_URL ??= "postgres://fixture:fixture@127.0.0.1:5432/fixture";
  const { db, tipsTable } = await import("@workspace/db");
  const query = db.select({ id: tipsTable.id })
    .from(tipsTable)
    .where(tipRefundableWhere(tipsTable))
    .toSQL();

  assert.match(query.sql, /status/);
  assert.ok(query.params.includes("pending"));
  assert.ok(query.params.includes("captured"));
  assert.ok(query.params.includes("failed"));
  assert.ok(query.params.includes("Payment failed"));
});