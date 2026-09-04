import { z } from "zod";

export const orderDocumentSchema = z.object({
  orderId: z.string().min(1),
  customerId: z.string().min(1),
  checkout: z.object({
    placedAt: z.string().datetime(),
    items: z.array(z.object({ sku: z.string().min(1), quantity: z.number().int().positive() })).min(1),
    currency: z.string().length(3),
    total: z.number().nonnegative()
  }),
  fulfillment: z.object({
    status: z.enum(["processing", "shipped", "delivered"]),
    carrier: z.string().optional(),
    trackingNumber: z.string().optional()
  }),
  receipt: z.object({ receiptNumber: z.string().min(1), issuedAt: z.string().datetime() }),
  updates: z.array(z.object({ at: z.string().datetime(), message: z.string().min(1) }))
});

export const ingestRequestSchema = z.object({
  collection: z.string().min(1),
  orders: z.array(orderDocumentSchema).min(1)
});

export type OrderDocument = z.infer<typeof orderDocumentSchema>;

export type CommerceChunk = {
  id: string;
  text: string;
  metadata: { order_id: string; customer_id: string; section: string };
};

export function chunkOrder(order: OrderDocument): CommerceChunk[] {
  const base = { order_id: order.orderId, customer_id: order.customerId };
  const items = order.checkout.items.map((item) => `${item.quantity} x ${item.sku}`).join(", ");
  const tracking = [order.fulfillment.carrier, order.fulfillment.trackingNumber].filter(Boolean).join(" ");

  return [
    {
      id: `${order.orderId}:checkout`,
      text: `Order ${order.orderId} was placed at ${order.checkout.placedAt}. Items: ${items}. Total: ${order.checkout.total} ${order.checkout.currency}.`,
      metadata: { ...base, section: "checkout" }
    },
    {
      id: `${order.orderId}:fulfillment`,
      text: `Order ${order.orderId} fulfillment is ${order.fulfillment.status}.${tracking ? ` Shipping: ${tracking}.` : ""}`,
      metadata: { ...base, section: "fulfillment" }
    },
    {
      id: `${order.orderId}:receipt`,
      text: `Receipt ${order.receipt.receiptNumber} for order ${order.orderId} was issued at ${order.receipt.issuedAt}.`,
      metadata: { ...base, section: "receipt" }
    },
    ...order.updates.map((update, index) => ({
      id: `${order.orderId}:update:${index + 1}`,
      text: `Order ${order.orderId} update at ${update.at}: ${update.message}`,
      metadata: { ...base, section: "update" }
    }))
  ];
}
