# XRP NFT Marketplace — Implementation Guide

---

## Do you need a testnet wallet?

Short answer: yes and no, depending on what you want to do.

**To read data** (fetch NFTs, fetch offers, check balances) — you don't need a wallet at all. XRPL nodes are public. Anyone can connect and query.

**To send transactions** (mint, create offer, settle, cancel) — you need a wallet with XRP in it. On testnet, you get one for free from the faucet. The app has buttons for that.

You need **three separate wallets** to test the full flow:
- A seller (holds the NFT, creates the sell offer)
- A buyer (has XRP, creates the buy offer)
- A broker (our marketplace account — settles the transaction)

On testnet none of this costs real money. The faucet gives ~1000 XRP per account.

---

## How XRPL works technically

### The network

XRPL is a distributed ledger maintained by a network of validator nodes. There's no mining — validators reach consensus using the Ripple Protocol Consensus Algorithm (RPCA). A new ledger closes roughly every 3–5 seconds.

There's no concept of "logging in". Every interaction is either a **read** (query the current ledger state) or a **write** (submit a signed transaction). Reads are free and require no identity. Writes require a valid signature from the account that owns the funds or assets being moved.

### How you connect (no login needed)

```js
const client = new xrpl.Client('wss://s.altnet.rippletest.net:51233')
await client.connect()
```

That's it. You're opening a WebSocket to a public XRPL node. No API key, no login, no token. The node accepts read requests from anyone. The only "auth" that exists in XRPL is cryptographic — if you want to submit a transaction, you sign it with your private key. The ledger verifies the signature and either accepts or rejects it.

### How transactions work

Every transaction on XRPL follows the same pattern:

1. **Build** — construct a JSON object describing what you want to do
2. **Autofill** — `client.autofill(tx)` fills in the fields you didn't set: `Sequence` (your account's transaction counter), `Fee` (calculated based on current load), `LastLedgerSequence` (deadline)
3. **Sign** — `wallet.sign(tx)` computes a cryptographic signature over the transaction. Private key never leaves the browser.
4. **Submit** — `client.submitAndWait(tx_blob)` broadcasts the signed transaction to the network and waits until it's included in a validated ledger

```js
const prepared = await client.autofill(tx)  // fills Sequence, Fee, etc.
const signed   = wallet.sign(prepared)       // signs with private key
const result   = await client.submitAndWait(signed.tx_blob)  // broadcasts + waits
```

`submitAndWait` blocks until the transaction is validated (or fails). The result includes `meta.TransactionResult` — if it's `tesSUCCESS`, it went through. Anything starting with `tec`, `tef`, `tem`, or `ter` means it failed, and the result code tells you why.

### Accounts and the reserve

XRPL accounts need a minimum XRP balance to exist — currently 10 XRP. This is called the **base reserve**. An account with less than 10 XRP can't be created. That's why the faucet deposits ~1000 XRP when you create a testnet account.

---

## Every XRPL function in the codebase explained

---

### `new xrpl.Client(url)`
Creates a client instance configured to connect to a specific XRPL node. The URL is a WebSocket endpoint (`wss://`). Doesn't connect yet — that's the next step.

```js
client = new xrpl.Client('wss://s.altnet.rippletest.net:51233')
```

---

### `client.connect()`
Opens the WebSocket connection to the node. Must be called before any requests. Returns a Promise.

```js
await client.connect()
```

---

### `client.disconnect()`
Closes the WebSocket cleanly.

---

### `client.isConnected()`
Returns `true` if the WebSocket is open and the client is ready to send requests.

---

### `xrpl.Wallet.fromSeed(seed)`
Derives a wallet (keypair + address) from a seed string. Deterministic — same seed always gives the same address. This is how you restore a wallet you've already created.

```js
const wallet = xrpl.Wallet.fromSeed('sXXXXXXXXXXXXXXX')
// wallet.address   → 'rXXXXXXXXXXXXXXX'
// wallet.publicKey → hex string
// wallet.seed      → same seed you passed in
```

---

### `xrpl.Wallet.generate()`
Creates a brand new random keypair. Generates a new seed, derives the address from it. Use this when you want a fresh account.

```js
const wallet = xrpl.Wallet.generate()
// wallet.seed    → 'sNEWSEEDXXXXXXXX'
// wallet.address → 'rNEWADDRXXXXXXXX'
```

---

### `wallet.sign(tx)`
Takes a prepared transaction object and signs it with the wallet's private key. Returns an object with `tx_blob` (the signed hex-encoded transaction ready to broadcast).

The signature is a cryptographic proof that the owner of this address authorized this specific transaction. XRPL validators verify it before including the tx in the ledger.

```js
const signed = wallet.sign(prepared)
// signed.tx_blob → hex string to submit
// signed.hash    → transaction hash
```

---

### `client.autofill(tx)`
Contacts the ledger to fill in fields you didn't set manually:
- `Sequence` — your account's transaction counter (prevents replay attacks)
- `Fee` — estimated transaction cost in drops, based on current network load
- `LastLedgerSequence` — a deadline; if the tx isn't included by this ledger index it's automatically dropped

You almost always want to call this before signing.

```js
const prepared = await client.autofill(tx)
```

---

### `client.submitAndWait(tx_blob)`
Broadcasts the signed transaction to the network and keeps polling until the transaction appears in a validated ledger (or fails). This is what makes it synchronous-feeling — it waits for confirmation, not just submission.

Under the hood it calls `submit` to broadcast, then `tx` repeatedly until the tx shows up or `LastLedgerSequence` is passed.

```js
const result = await client.submitAndWait(signed.tx_blob)
// result.result.meta.TransactionResult → 'tesSUCCESS' or error code
// result.result.hash                   → transaction hash
// result.result.meta.AffectedNodes     → every ledger object changed by this tx
```

---

### `client.fundWallet(wallet)`
Only works on testnet/devnet. Hits the Ripple testnet faucet API, which creates the account on-chain and deposits ~1000 XRP. Returns the funded wallet object and the balance.

```js
const result = await client.fundWallet(wallet)
// result.wallet  → wallet object (same keys, new address if freshly generated)
// result.balance → XRP balance after funding
```

---

### `client.request({ command: 'account_info', ... })`
Queries ledger state for a specific account. Returns account data including the XRP balance (`Balance` field, in drops).

```js
const res = await client.request({
  command: 'account_info',
  account: 'rXXXX',
  ledger_index: 'validated'   // use the latest validated ledger
})
// res.result.account_data.Balance → drops (divide by 1,000,000 for XRP)
```

---

### `client.request({ command: 'account_nfts', ... })`
Returns all NFTs currently owned by an address. Each NFT includes its `NFTokenID`, `TransferFee`, `Flags`, `URI` (hex), and `NFTokenTaxon`.

```js
const res = await client.request({ command: 'account_nfts', account: 'rXXXX' })
// res.result.account_nfts → array of NFT objects
```

---

### `client.request({ command: 'nft_sell_offers', nft_id: id })`
Returns all open sell offers for a given NFTokenID. Each offer has: `nft_offer_index` (the offer's ledger index), `owner`, `amount` (in drops), `destination` (optional), `expiration` (optional).

If there are no sell offers this command returns an error — not an empty array. That's why we use `Promise.allSettled` instead of `Promise.all` when fetching both sell and buy offers together.

```js
const res = await client.request({ command: 'nft_sell_offers', nft_id: 'NFTOKENID' })
// res.result.offers → array of offer objects
```

---

### `client.request({ command: 'nft_buy_offers', nft_id: id })`
Same as above but for buy offers.

---

### NFTokenMint transaction

Creates a new NFT on the ledger. The signing account becomes the issuer and initial owner.

```js
{
  TransactionType: 'NFTokenMint',
  Account: wallet.address,
  NFTokenTaxon: 0,          // creator-defined category, can be any number
  TransferFee: 1000,        // 1000 = 1% royalty on every future resale (immutable)
  Flags: 8,                 // 8 = tfTransferable — required for the NFT to be resellable
  URI: 'hexEncodedURL'      // metadata link, stored on-chain as hex
}
```

**TransferFee math:** `1000 units / 100,000 = 0.01 = 1%`. Range 0–50,000 (0%–50%).

**Flags:** `8` is `tfTransferable`. Without it, the NFT can only transfer back to the issuer — meaning it can't be sold on a marketplace at all.

---

### NFTokenCreateOffer transaction — sell offer

The seller announces they want to sell a specific NFT for a minimum price.

```js
{
  TransactionType: 'NFTokenCreateOffer',
  Account: sellerWallet.address,
  NFTokenID: 'TOKENID',
  Amount: '95000000',   // 95 XRP in drops
  Flags: 1,             // 1 = tfSellNFToken — marks this as a sell offer
  Destination: 'rBROKER...'  // optional — restricts acceptance to this address only
}
```

`Destination` is useful in the broker flow: the seller can lock the offer so only our broker account can accept it. If you leave it blank, anyone can accept the offer directly (including the buyer in direct mode).

---

### NFTokenCreateOffer transaction — buy offer

The buyer announces they want to buy a specific NFT and how much they'll pay.

```js
{
  TransactionType: 'NFTokenCreateOffer',
  Account: buyerWallet.address,
  NFTokenID: 'TOKENID',
  Amount: '100000000',  // 100 XRP in drops
  Owner: 'rSELLER...',  // required — current owner of the NFT
  Flags: 0              // no flag = buy offer
}
```

`Owner` is required because XRPL needs to know where the NFT is coming from. It verifies the NFT actually belongs to that address before the offer can be matched.

---

### NFTokenAcceptOffer transaction — broker mode

Our marketplace submits this to match and settle both offers atomically.

```js
{
  TransactionType: 'NFTokenAcceptOffer',
  Account: brokerWallet.address,
  NFTokenSellOffer: 'SELL_OFFER_INDEX',  // ledger index of the sell offer
  NFTokenBuyOffer:  'BUY_OFFER_INDEX',   // ledger index of the buy offer
  NFTokenBrokerFee: '5000000'            // optional — 5 XRP broker cut in drops
}
```

When both offer indexes are present, XRPL runs in broker mode. The ledger:
1. Checks that the buy amount ≥ sell amount (otherwise rejected)
2. Debits the buyer
3. Pays the issuer their `TransferFee` percentage
4. Pays the broker `NFTokenBrokerFee` (if set — must be ≤ the spread)
5. Credits the seller the remainder
6. Transfers ownership of the NFT to the buyer

All of this happens in one atomic operation. If anything fails the whole thing reverts.

---

### NFTokenCancelOffer transaction

Removes one or more offers from the ledger. `NFTokenOffers` is an array so you can cancel multiple at once.

```js
{
  TransactionType: 'NFTokenCancelOffer',
  Account: wallet.address,
  NFTokenOffers: ['OFFER_INDEX_1', 'OFFER_INDEX_2']
}
```

Only the offer creator can cancel their own offer (or the NFT owner in some cases).

---

## How offer indexes work

When you submit `NFTokenCreateOffer`, the ledger creates a new entry called an `NFTokenOffer`. That entry gets a unique identifier — the **offer index** (also called ledger index). It's a 64-character hex string.

To find it after submission, you look in `result.meta.AffectedNodes` for a `CreatedNode` with `LedgerEntryType === 'NFTokenOffer'` and read its `LedgerIndex`:

```js
const node     = meta.AffectedNodes.find(n => n.CreatedNode?.LedgerEntryType === 'NFTokenOffer')
const offerIdx = node.CreatedNode.LedgerIndex
```

This index is what you pass to `NFTokenAcceptOffer` or `NFTokenCancelOffer`.

---

## Drops vs XRP

XRPL internally uses **drops** for all amounts. 1 XRP = 1,000,000 drops. All `Amount` fields in transactions must be strings of drops (not floats of XRP).

```js
// XRP → drops
const drops = String(Math.floor(xrp * 1_000_000))

// drops → XRP
const xrp = Number(drops) / 1_000_000
```

This matters because `Amount: "95"` means 95 drops (0.000095 XRP), not 95 XRP. Always convert.

---

## Running the frontend

No server needed. Just open `frontend/index.html` directly in a browser.

```
frontend/
  index.html   ← UI structure + Tailwind
  app.js       ← all XRPL logic
```

Test flow:
1. Open `index.html`
2. Click **Connect**
3. Generate + fund all 3 wallets
4. Mint NFT (step 1)
5. Create sell offer (step 2)
6. Create buy offer (step 3) — click "← seller addr" to fill the owner field
7. Click "auto" to calculate broker fee, then **Settle Transaction**
8. Watch balances update, click the explorer link to verify on-chain
