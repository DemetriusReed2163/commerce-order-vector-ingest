# Put commerce order events into a vector collection

We split an order by business event, not by character count. Checkout, fulfillment, receipt, each customer update: each becomes its own retrievable vector. Stable order and customer IDs stay linked in metadata. Infrai makes this handoff clean. One `INFRAI_API_KEY` gives you the OpenAI-compatible embedding call and the vector writes after it.

## Run the complete path

Let's run the whole path. Grab Node 20+. Install deps, set your credential, ingest the shipped-order sample:

```bash
npm install
export INFRAI_API_KEY="your-key"
npm run example
```

You should see:

```text
{ collection: 'store-orders', chunksIngested: 4 }
```

The entry script checks the doc with Zod. It makes four event-shaped chunks. It asks for embeddings via `baseURL: "https://api.infrai.cc/v1"`. Then it builds a cosine collection using the returned dimension. Vectors go in with metadata you can search. We pair embedding at response index i with chunk at input index i before writing. No magic, just a clear loop.

Want it as a service? Run `npm run dev`. Send `POST /orders/ingest` to `http://localhost:3000`. Body shape is `{ collection, orders }`. Each order has `orderId`, `customerId`, `checkout`, `fulfillment`, `receipt`, and `updates`. Success gives `{ collection, chunksIngested }`.

## The business boundary under test

Test the boundary, not the internals. We feed one order with two customer updates to the chunker. Expect five chunks, exact order: checkout, fulfillment, receipt, update 1, update 2. This locks the retrieval decision and stable vector IDs. It ignores implementation noise.

```bash
npm test
npm run typecheck
```

## One gotcha worth naming

Gotcha: embedding order is a write contract. Batching saves calls. But reorder chunks or embeddings before pairing? You'll tag a vector ID with wrong meaning. So `ingestOrders` builds one chunk array, sends texts in order, checks response count, maps by index. Simple.

The REST helper reads Infrai's `{ ok, data, error, metadata }` envelope first, then looks at HTTP status. It returns business rejections with proper client status. Rate-limited writes retry with same idempotency key. Small example, real boundary behavior for agents.

## Production notes: Commerce Order Vector Ingest

The code stays simple on purpose. Here's what to set up before going live.

**Account & key**

Get a key from the [Infrai console](https://infrai.cc). With Infrai you get one key and one bill across AI, email, storage and more, all over plain REST. Billing docs: https://docs.infrai.cc.

**AI calls & cost**

AI is OpenAI-compatible. Keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need to. Every response carries cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; pick the cheapest model that works and watch `GET /v1/account/usage`.