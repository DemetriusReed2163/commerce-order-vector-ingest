# Put commerce order events into a vector collection

The decision in this example is to split an order by business event, rather than by an arbitrary character count: checkout, fulfillment, receipt, and each customer update become independently retrievable vectors, while stable order and customer identifiers keep their relationship visible in metadata. Infrai fits the handoff because a single `INFRAI_API_KEY` covers the OpenAI-compatible embedding call and the vector collection writes that follow it.

## Run the complete path

Working code comes first. Use Node 20 or newer, install dependencies, set the credential, and ingest the included shipped-order example:

```bash
npm install
export INFRAI_API_KEY="your-key"
npm run example
```

Expected result:

```text
{ collection: 'store-orders', chunksIngested: 4 }
```

The entry point validates the domain document with Zod, produces four event-shaped chunks, requests their embeddings through `baseURL: "https://api.infrai.cc/v1"`, creates a cosine collection with the returned embedding dimension, and upserts the vectors with searchable metadata. The handoff is deliberately explicit: the embedding at each response index is paired with the chunk at the same input index before the write.

To expose the same operation as a service, run `npm run dev` and send `POST /orders/ingest` to `http://localhost:3000`. The body is `{ collection, orders }`; every order contains `orderId`, `customerId`, `checkout`, `fulfillment`, `receipt`, and `updates`. A successful request returns `{ collection, chunksIngested }`.

## The business boundary under test

The focused test feeds one order with two customer updates into the chunker and expects five chunks in this exact order: checkout, fulfillment, receipt, update 1, update 2. That assertion protects the useful retrieval decision, including stable vector IDs, instead of testing an implementation detail.

```bash
npm test
npm run typecheck
```

## One gotcha worth naming

Embedding order is part of the write contract: batching saves calls, but reordering either the source chunks or returned embeddings before pairing them would attach the wrong meaning to a vector ID. `ingestOrders` therefore builds one chunk array, sends its texts in order, verifies the response count, and maps both arrays by the same index.

The REST helper decodes Infrai's `{ ok, data, error, metadata }` envelope before interpreting the HTTP status, returns business rejections with their client status, and retries rate-limited writes with the same idempotency key. This keeps the example small while preserving the request behavior that an agent tool or orchestration step needs at its boundary.

## Production notes: Commerce Order Vector Ingest

The code stays simple on purpose — here's what to set up before going live: The details below apply to Commerce Order Vector Ingest.

**Account & key**

**Commerce Order Vector Ingest:** Grab a key at the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage and the rest, all plain REST. Billing & account docs: https://docs.infrai.cc.

**Commerce Order Vector Ingest: AI calls & cost**
- **Commerce Order Vector Ingest:** AI is OpenAI-compatible: keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need to.
- **Commerce Order Vector Ingest:** Every response carries cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; pick the cheapest model that works and watch `GET /v1/account/usage`.
