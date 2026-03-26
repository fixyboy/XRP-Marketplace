# XRP NFT Resale Marketplace

**Blockchain:** XRP Ledger (XRPL)
**Scope:** Secondary market for NFT resale with protocol-level royalty enforcement
**Team:** Marketplace layer — minting is handled separately by our binôme

---

## What we're building

The goal is a marketplace where anyone holding an NFT can resell it, and where the original creator automatically gets their royalty cut on every secondary sale — without us doing anything special to make that happen. The XRPL handles it at the consensus layer.

What makes this different from most NFT marketplaces is that royalties here can't be bypassed. They're baked into the token at mint time and enforced by the ledger itself, not by our code. We can't turn them off even if we wanted to.

Our platform sits in the middle as a **non-custodial broker**. We never hold funds, never hold NFTs. We just match a seller's offer with a buyer's offer and submit one transaction that settles everything atomically.

---

## The problem with existing markets

Most secondary NFT markets have the same structural weaknesses. Royalties are enforced at the app layer, which means any marketplace (or a direct peer-to-peer transfer) can skip them. Platforms often hold funds in escrow during negotiation, which creates counterparty risk. And distributing fees to multiple parties — creator, platform, seller — typically requires coordinated off-chain logic that can fail or be manipulated.

XRPL's native NFT standard (`XLS-20`) was designed to fix all three of these at the protocol level.

---

## How XRPL NFTs work

Every NFT on XRPL has a 256-bit `NFTokenID`. The issuer's address is cryptographically embedded in this ID — it can't be faked or changed after the fact.

The important field for us is `TransferFee`, which the creator sets when minting. It defines the percentage of every future sale that gets routed back to them automatically. Once minted, that value is immutable — nobody can change it, including us. The range is 0 to 50,000 units, where 1,000 units = 1%.

For a token to be listable on our marketplace it also needs the `tfTransferable` flag set at mint. Without it, the NFT can only go back to the issuer. We check this before showing anything in the catalog.

---

## The broker flow

XRPL has three transaction types we care about: `NFTokenCreateOffer`, `NFTokenAcceptOffer`, and `NFTokenCancelOffer`.

The core mechanic works like this. The seller submits a `NFTokenCreateOffer` with `Flags: 1` (`tfSellNFToken`) and their minimum price. The buyer submits their own `NFTokenCreateOffer` without that flag, with the amount they're willing to pay. Then our platform — acting as broker — submits a single `NFTokenAcceptOffer` referencing both offers at once.

The ledger then distributes funds in this exact order, atomically:

```
Buyer pays → Creator gets royalty (TransferFee %) → Broker gets spread → Seller gets the rest
```

If anything fails, nothing moves. There's no partial state. The broker (us) earns the spread between what the buyer paid and what the seller asked.

```
Example — seller asks 95 XRP, buyer bids 100 XRP, TransferFee = 1%

  Buyer pays:       100 XRP
  Creator gets:       1 XRP   (1% enforced by ledger)
  Marketplace gets:   5 XRP   (spread we captured as broker)
  Seller gets:       94 XRP
```

The raw transactions look like this:

**Sell offer (seller signs this):**
```json
{
  "TransactionType": "NFTokenCreateOffer",
  "Account": "<seller>",
  "NFTokenID": "<token_id>",
  "Amount": "95000000",
  "Flags": 1
}
```

**Buy offer (buyer signs this):**
```json
{
  "TransactionType": "NFTokenCreateOffer",
  "Account": "<buyer>",
  "NFTokenID": "<token_id>",
  "Amount": "100000000",
  "Flags": 0
}
```

**Broker settlement (our platform signs this):**
```json
{
  "TransactionType": "NFTokenAcceptOffer",
  "Account": "<broker>",
  "NFTokenSellOffer": "<sell_offer_index>",
  "NFTokenBuyOffer": "<buy_offer_index>"
}
```

The 5 XRP spread goes directly to the broker account. No special logic needed on our end — the ledger handles the distribution.

---

## Security

A few things worth noting. The atomicity of `NFTokenAcceptOffer` means there's no double-spend risk — if any part of the transaction fails, the whole thing reverts. The `TransferFee` is consensus-level, so there's literally no application path to bypass it. All offers reference an `NFTokenID` that has to exist on-chain, so fake listings can't be submitted. And XRPL transactions are sequenced per account, so replays are impossible.

The broker account intentionally holds near zero XRP beyond what's needed for transaction fees. It never touches the actual funds being transferred — the ledger routes everything directly between parties. If the broker key were ever compromised, the attacker couldn't steal anything because there's nothing there to steal.

---

## What we get from the minting team

The other team mints the NFTs. What matters to us from each token they produce:

- `TransferFee` — we display this on each listing so buyers know what the creator takes
- `Flags: tfTransferable` — required, we reject listings where this isn't set
- `URI` — the metadata link (name, description, preview image)
- `NFTokenID` — the primary key for everything we do

We don't need any side agreement with them about royalties. Whatever they set in `TransferFee` at mint time is what gets enforced, automatically, forever.

---

## Scope

We handle: offer listing and display, broker settlement, wallet-based auth, secondary sale indexing, and commission capture.

We don't handle: minting, royalty rate decisions, file encryption, license logic, or the primary market.

---

## References

- [XRPL NFT Concepts](https://xrpl.org/docs/concepts/tokens/nfts/)
- [NFTokenMint](https://xrpl.org/docs/references/protocol/transactions/types/nftokenmint)
- [NFTokenCreateOffer](https://xrpl.org/docs/references/protocol/transactions/types/nftokencreateoffer)
- [NFTokenAcceptOffer](https://xrpl.org/docs/references/protocol/transactions/types/nftokenacceptoffer)
- [Trading NFTs on XRPL](https://xrpl.org/docs/concepts/tokens/nfts/trading)
- [Broker an NFT Sale — JS Tutorial](https://xrpl.org/docs/tutorials/javascript/nfts/broker-an-nft-sale)
