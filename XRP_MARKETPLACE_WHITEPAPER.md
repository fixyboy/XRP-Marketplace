# XRP NFT Resale Marketplace — Technical Whitepaper

**Project scope:** Secondary market platform for NFT resale with on-chain royalty enforcement
**Blockchain:** XRP Ledger (XRPL)
**Team scope:** Marketplace layer (counterpart team handles NFT minting)

---

## 1. Abstract

This document describes the design and implementation of a secondary NFT marketplace built natively on the XRP Ledger. The marketplace enables NFT holders to list, negotiate, and finalize resales through a broker-mode settlement model. Creator royalties are enforced at the protocol level via the `TransferFee` field set at mint time — the marketplace does not implement royalty logic; it inherits it from consensus.

The platform acts as a non-custodial broker: it never holds funds, never takes custody of NFTs, and cannot unilaterally move assets. Every settlement is a single atomic transaction on the XRPL, executed only when both a valid sell offer and a valid buy offer exist for the same `NFTokenID`.

---

## 2. Problem Statement

Secondary NFT markets on most chains suffer from three structural problems:

1. **Royalty circumvention** — royalties are enforced at the application layer, not the protocol layer. Marketplaces can bypass them, and peer-to-peer transfers skip them entirely.
2. **Custodial risk** — many marketplaces hold escrowed funds or NFTs during the negotiation period, creating counterparty risk.
3. **Settlement complexity** — multi-party fee distribution (creator, platform, seller) requires coordinated off-chain logic that can fail or be manipulated.

XRPL's native NFT model (`XLS-20`) resolves all three at the protocol level.

---

## 3. XRPL NFT Primitives

### 3.1 NFToken and NFTokenID

Each NFT on XRPL is identified by a 256-bit `NFTokenID`. This identifier encodes:
- The issuer's account address (immutable)
- A `NFTokenTaxon` (creator-defined classification)
- A sequence number

The issuer identity is cryptographically embedded in the token ID — it cannot be spoofed or reassigned.

### 3.2 TransferFee (On-Chain Royalties)

Set during `NFTokenMint`, the `TransferFee` field specifies the percentage of every secondary sale automatically routed to the original issuer. It is **immutable after minting**.

- Unit: 1/100,000 of the sale amount (1 unit = 0.001%)
- Range: 0 – 50,000 (i.e., 0% to 50%)
- Enforcement: XRPL consensus — not application logic

Payment flow on every resale:
```
Buyer's funds → Issuer (TransferFee %) → Broker (spread) → Seller (remainder)
```

This ordering is deterministic and enforced by the ledger. Neither the marketplace nor the seller can intercept the royalty.

### 3.3 Transferability Flag

NFTs minted with the `tfTransferable` flag (value `8`) can be transferred between accounts. Without this flag, the NFT can only be transferred back to the issuer. The marketplace checks this flag before listing any token.

---

## 4. Marketplace Architecture

### 4.1 Settlement Model: Broker Mode

The XRPL `NFTokenAcceptOffer` transaction supports two execution modes:

| Mode | Description |
|---|---|
| **Direct** | One party accepts the other's offer. No intermediary. |
| **Broker** | A third-party account specifies both a sell offer and a buy offer. The ledger settles all parties atomically. |

Our marketplace operates exclusively in **broker mode**. This gives the platform the ability to:
- Match offers programmatically
- Capture a commission as the spread between the seller's ask and the buyer's bid
- Execute settlement in a single transaction without custodying any assets

### 4.2 Transaction Flow

```
1. Seller submits NFTokenCreateOffer
   - Flag: tfSellNFToken (0x01)
   - Amount: minimum acceptable price (in drops or IOU)
   - NFTokenID: token being sold
   - Destination: (optional) restrict to specific buyer or broker

2. Buyer submits NFTokenCreateOffer
   - Flag: none (buy offer)
   - Amount: maximum willing to pay
   - NFTokenID: same token

3. Marketplace backend detects matching offers via XRPL subscription
   - Validates: same NFTokenID, buyer amount ≥ seller amount
   - Calculates: broker fee = buyer amount − seller amount

4. Marketplace account submits NFTokenAcceptOffer
   - NFTokenSellOffer: sell offer index
   - NFTokenBuyOffer: buy offer index
   - Ledger executes atomically:
       a. Buyer debited
       b. Issuer credited (TransferFee)
       c. Broker credited (spread)
       d. Seller credited (net)
```

The entire settlement is one XRPL transaction. It either succeeds completely or fails completely — no partial states.

### 4.3 Commission Structure

The marketplace earns revenue by setting the buyer's minimum offer requirement above the seller's ask price. The spread is claimed by the broker account during `NFTokenAcceptOffer` execution.

```
Example:
  Seller ask:        95 XRP
  Buyer bid:        100 XRP
  TransferFee:        1% (1000 units set at mint)

  Buyer pays:       100 XRP
  Issuer receives:    1 XRP  (1% royalty, enforced by ledger)
  Marketplace gets:   5 XRP  (broker spread: 100 − 95)
  Seller receives:   94 XRP  (ask minus royalty: 95 − 1)
```

---

## 5. System Design

### 5.1 Components

```
┌─────────────────────────────────────────────────────┐
│                    XRPL Testnet/Mainnet              │
│  NFTokenCreateOffer  NFTokenAcceptOffer  Ledger Sub  │
└──────────────────────────┬──────────────────────────┘
                           │ xrpl.js (WebSocket)
┌──────────────────────────▼──────────────────────────┐
│                     Backend (Node.js)                │
│  - XRPL indexer (subscribes to transactions)         │
│  - Offer store (PostgreSQL)                          │
│  - Broker engine (match & settle)                    │
│  - REST API (served to frontend)                     │
└──────────────────────────┬──────────────────────────┘
                           │ HTTP / WebSocket
┌──────────────────────────▼──────────────────────────┐
│                    Frontend (Nuxt 3)                 │
│  - Catalog, NFT detail pages                         │
│  - Wallet connection (XUMM or xrpl.js client)        │
│  - Offer creation UI (signs tx client-side)          │
└─────────────────────────────────────────────────────┘
```

### 5.2 XRPL Indexer

The backend maintains a WebSocket subscription to the XRPL node, listening for:
- `NFTokenCreateOffer` transactions (new listings and bids)
- `NFTokenAcceptOffer` transactions (completed sales)
- `NFTokenCancelOffer` transactions (removed listings)

This event stream drives the local database, which stores the current state of all active offers for fast frontend queries without hitting the XRPL RPC on every page load.

### 5.3 Wallet Authentication

There are no traditional user accounts. Identity is established by wallet ownership:

1. Backend generates a one-time challenge nonce
2. User signs the nonce with their XRPL private key (via XUMM or compatible wallet)
3. Backend verifies the signature against the claimed public key
4. Session token issued — valid for the duration of the session

This is the XRPL equivalent of Sign-In With Ethereum (SIWE).

### 5.4 Offer Lifecycle

```
NFTokenCreateOffer submitted
         │
         ▼
    [PENDING on ledger]
         │
    ┌────┴────────────────────────┐
    │                             │
Matched by broker          Expired / Cancelled
(NFTokenAcceptOffer)       (NFTokenCancelOffer)
    │                             │
[SETTLED — ledger final]   [REMOVED from ledger]
```

Offers that include an `Expiration` field are automatically invalidated by the ledger after the specified ledger index. The indexer handles pruning stale entries from the local database.

---

## 6. Data Model (Local DB)

```sql
-- NFTs indexed from chain
nfts (
  nftoken_id        TEXT PRIMARY KEY,
  issuer            TEXT NOT NULL,
  transfer_fee_bps  INTEGER NOT NULL,   -- units from TransferFee field
  uri               TEXT,
  is_transferable   BOOLEAN NOT NULL,
  owner             TEXT NOT NULL,
  indexed_at        TIMESTAMPTZ DEFAULT now()
)

-- Active sell and buy offers
offers (
  offer_index   TEXT PRIMARY KEY,       -- XRPL offer ledger index
  nftoken_id    TEXT REFERENCES nfts,
  owner         TEXT NOT NULL,
  amount_drops  BIGINT NOT NULL,
  offer_type    TEXT CHECK (offer_type IN ('sell', 'buy')),
  expiration    INTEGER,                -- ledger index
  destination   TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
)

-- Completed sales
sales (
  tx_hash       TEXT PRIMARY KEY,
  nftoken_id    TEXT REFERENCES nfts,
  seller        TEXT NOT NULL,
  buyer         TEXT NOT NULL,
  gross_drops   BIGINT NOT NULL,
  royalty_drops BIGINT NOT NULL,
  broker_drops  BIGINT NOT NULL,
  net_drops     BIGINT NOT NULL,
  settled_at    TIMESTAMPTZ DEFAULT now()
)
```

---

## 7. Key XRPL Transaction Reference

### NFTokenCreateOffer (Sell)

```json
{
  "TransactionType": "NFTokenCreateOffer",
  "Account": "<seller_address>",
  "NFTokenID": "<token_id>",
  "Amount": "95000000",
  "Flags": 1
}
```

### NFTokenCreateOffer (Buy)

```json
{
  "TransactionType": "NFTokenCreateOffer",
  "Account": "<buyer_address>",
  "NFTokenID": "<token_id>",
  "Amount": "100000000",
  "Flags": 0
}
```

### NFTokenAcceptOffer (Broker Mode)

```json
{
  "TransactionType": "NFTokenAcceptOffer",
  "Account": "<broker_address>",
  "NFTokenSellOffer": "<sell_offer_index>",
  "NFTokenBuyOffer": "<buy_offer_index>"
}
```

The spread (`100000000 − 95000000 = 5000000 drops`) is automatically credited to the broker account. The `TransferFee` is applied before the broker receives its share.

---

## 8. Security Considerations

| Threat | Mitigation |
|---|---|
| Broker double-spend | Atomicity of `NFTokenAcceptOffer` — ledger rejects if any leg fails |
| Royalty bypass | `TransferFee` enforced at consensus — no application path exists to bypass it |
| Fake NFT listings | All offers reference an `NFTokenID` that must exist on-chain |
| Replay attacks | XRPL transactions are sequenced per account — sequence number prevents replay |
| Broker key compromise | Broker account holds no funds; it only submits `NFTokenAcceptOffer` |

The broker account is intentionally kept with zero balance beyond transaction fees. It cannot steal funds because it never holds them — it only submits the acceptance transaction, and the ledger handles distribution directly.

---

## 9. Integration with Minting Team

The minting team (counterpart) produces NFTs with the following parameters that directly drive marketplace behavior:

| Mint parameter | Marketplace consumption |
|---|---|
| `TransferFee` | Displayed on NFT detail page; automatically deducted by ledger on every sale |
| `Flags: tfTransferable` | Required for listing — marketplace rejects non-transferable NFTs |
| `URI` | Resolved for metadata (name, description, preview image) |
| `NFTokenID` | Primary key for all marketplace queries and offer matching |

No off-chain agreement between the two teams is needed for royalty enforcement — the protocol handles it.

---

## 10. Scope Boundaries

| In scope (our team) | Out of scope |
|---|---|
| Offer listing and display | NFT minting |
| Broker settlement engine | Creator royalty rate decisions |
| Wallet auth (Sign-In With XRPL) | File encryption / decryption |
| Secondary sale indexing | License NFT logic |
| Commission capture via broker spread | First-sale primary market |

---

## 11. References

- [XRPL NFT Concepts](https://xrpl.org/docs/concepts/tokens/nfts/)
- [NFTokenMint Transaction](https://xrpl.org/docs/references/protocol/transactions/types/nftokenmint)
- [NFTokenCreateOffer Transaction](https://xrpl.org/docs/references/protocol/transactions/types/nftokencreateoffer)
- [NFTokenAcceptOffer Transaction](https://xrpl.org/docs/references/protocol/transactions/types/nftokenacceptoffer)
- [Trading NFTs on XRPL](https://xrpl.org/docs/concepts/tokens/nfts/trading)
- [NFT Marketplace Use Case](https://xrpl.org/docs/use-cases/tokenization/nft-marketplace)
- [Broker an NFT Sale (JavaScript)](https://xrpl.org/docs/tutorials/javascript/nfts/broker-an-nft-sale)
