import assert from "node:assert/strict";
import test from "node:test";
import { chunkOrder, orderDocumentSchema } from "../src/commerce_chunks.js";

test("keeps checkout, fulfillment, receipt, and each update independently retrievable", () => {
  const order = orderDocumentSchema.parse({
    orderId: "ord_7",
    customerId: "cus_2",
    checkout: {
      placedAt: "2026-08-31T09:30:00.000Z",
      items: [{ sku: "lamp-green", quantity: 1 }],
      currency: "USD",
      total: 64
    },
    fulfillment: { status: "processing" },
    receipt: { receiptNumber: "rcpt_7", issuedAt: "2026-08-31T09:31:00.000Z" },
    updates: [
      { at: "2026-08-31T10:00:00.000Z", message: "Warehouse accepted the order" },
      { at: "2026-08-31T11:00:00.000Z", message: "Item was packed" }
    ]
  });

  const chunks = chunkOrder(order);
  assert.deepEqual(chunks.map((chunk) => chunk.id), [
    "ord_7:checkout",
    "ord_7:fulfillment",
    "ord_7:receipt",
    "ord_7:update:1",
    "ord_7:update:2"
  ]);
  assert.equal(chunks[3].metadata.section, "update");
  assert.match(chunks[0].text, /lamp-green/);
});
