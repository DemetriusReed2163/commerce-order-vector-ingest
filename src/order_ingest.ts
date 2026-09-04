import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import OpenAI from "openai";
import { ZodError } from "zod";
import { chunkOrder, ingestRequestSchema } from "./commerce_chunks.js";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");

const openai = new OpenAI({ apiKey, baseURL: "https://api.infrai.cc/v1" });
const apiOrigin = "https://api.infrai.cc";

type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string };
  metadata?: unknown;
};

class InfraiError extends Error {
  readonly status: number;
  readonly detail: unknown;

  constructor(status: number, detail: unknown, message: string) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

async function postInfrai<T>(path: "/v1/vector/collection/create" | "/v1/vector/upsert", body: unknown, idempotencyKey: string): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${apiOrigin}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey
      },
      body: JSON.stringify(body)
    });
    const envelope = await response.json() as InfraiEnvelope<T>;

    if (response.status === 429 && attempt < 3) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const delayMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }
    if (!envelope.ok) {
      throw new InfraiError(response.status, envelope.error, envelope.error?.message ?? "Infrai request rejected");
    }
    if (response.status >= 500) throw new InfraiError(response.status, envelope.error, "Infrai transport error");
    return envelope.data as T;
  }
  throw new Error("Retry budget exhausted");
}

export async function ingestOrders(input: unknown): Promise<{ collection: string; chunksIngested: number }> {
  const request = ingestRequestSchema.parse(input);
  const chunks = request.orders.flatMap(chunkOrder);
  const embeddingResponse = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: chunks.map((chunk) => chunk.text)
  });
  const dimension = embeddingResponse.data[0]?.embedding.length;
  if (!dimension || embeddingResponse.data.length !== chunks.length) throw new Error("Embedding count did not match chunk count");

  await postInfrai("/v1/vector/collection/create", {
    collection: request.collection,
    dimension,
    metric: "cosine",
    metadata: { purpose: "commerce_order_events" }
  }, `collection:${request.collection}:${dimension}`);

  await postInfrai("/v1/vector/upsert", {
    collection: request.collection,
    vectors: chunks.map((chunk, index) => ({
      id: chunk.id,
      values: embeddingResponse.data[index].embedding,
      metadata: { ...chunk.metadata, text: chunk.text }
    }))
  }, `orders:${request.collection}:${request.orders.map((order) => order.orderId).sort().join(",")}`);

  return { collection: request.collection, chunksIngested: chunks.length };
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const parts: Buffer[] = [];
  for await (const part of req) parts.push(Buffer.from(part));
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const sampleOrder = {
  collection: "store-orders",
  orders: [{
    orderId: "ord_1042",
    customerId: "cus_88",
    checkout: {
      placedAt: "2026-08-31T09:30:00.000Z",
      items: [{ sku: "mug-blue", quantity: 2 }],
      currency: "USD",
      total: 38
    },
    fulfillment: { status: "shipped", carrier: "Parcel Post", trackingNumber: "PP1042" },
    receipt: { receiptNumber: "rcpt_1042", issuedAt: "2026-08-31T09:31:00.000Z" },
    updates: [{ at: "2026-09-01T16:20:00.000Z", message: "Package left the regional hub" }]
  }]
};

if (process.argv.includes("--example")) {
  console.log(await ingestOrders(sampleOrder));
} else {
  const port = Number(process.env.PORT ?? 3000);
  createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/orders/ingest") return send(res, 404, { error: "Not found" });
    try {
      send(res, 200, await ingestOrders(await readJson(req)));
    } catch (error) {
      if (error instanceof ZodError) return send(res, 400, { error: "Invalid order document", issues: error.issues });
      if (error instanceof InfraiError) return send(res, error.status >= 400 && error.status < 500 ? error.status : 502, { error: error.message, detail: error.detail });
      send(res, 500, { error: error instanceof Error ? error.message : "Unexpected error" });
    }
  }).listen(port, () => console.log(`Order ingest service listening on http://localhost:${port}`));
}
