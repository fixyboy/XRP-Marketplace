// ─── State ────────────────────────────────────────────────────────────────────
let client = null
const wallets = { seller: null, buyer: null, broker: null }

// ─── Connection ───────────────────────────────────────────────────────────────

// Opens (or closes) a WebSocket connection to the XRPL testnet node.
// xrpl.Client wraps the WebSocket — no auth needed, XRPL nodes are public.
async function toggleConnect() {
  if (client && client.isConnected()) {
    await client.disconnect()
    client = null
    setConnState(false)
    log('disconnected', 'info')
    return
  }

  const node = 'wss://s.altnet.rippletest.net:51233'
  log(`connecting to ${node}…`, 'info')
  client = new xrpl.Client(node)
  try {
    await client.connect()
    setConnState(true)
    log('connected to XRPL testnet', 'ok')
  } catch (e) {
    log('connection failed: ' + e.message, 'err')
    client = null
  }
}

function setConnState(connected) {
  document.getElementById('conn-dot').className =
    `w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-500'}`
  document.getElementById('conn-label').textContent = connected ? 'connected' : 'disconnected'
  document.getElementById('conn-btn').textContent   = connected ? 'Disconnect' : 'Connect'
}

function requireClient() {
  if (!client || !client.isConnected()) { log('not connected to XRPL', 'err'); return false }
  return true
}

function requireWallet(role) {
  if (!wallets[role]) { log(`${role} wallet not loaded`, 'err'); return false }
  return true
}

// ─── Wallets ──────────────────────────────────────────────────────────────────

// Derives (or generates) an XRPL keypair from a seed.
// xrpl.Wallet.fromSeed(seed) → derives the address + private key deterministically
// xrpl.Wallet.generate()    → creates a brand new random keypair
// The wallet object holds: seed, publicKey, privateKey, address
async function loadWallet(role) {
  const seed = document.getElementById(`${role}-seed`).value.trim()
  try {
    const wallet = seed ? xrpl.Wallet.fromSeed(seed) : xrpl.Wallet.generate()
    wallets[role] = wallet
    document.getElementById(`${role}-seed`).value = wallet.seed
    document.getElementById(`${role}-addr`).textContent = wallet.address
    document.getElementById(`${role}-info`).classList.remove('hidden')
    log(`${role}: ${wallet.address}`, 'ok')
    if (client?.isConnected()) await refreshBalance(role)
  } catch (e) {
    log(`wallet load failed (${role}): ${e.message}`, 'err')
  }
}

// Calls account_info on the ledger to read the XRP balance for a given address.
// Balance is returned in drops (1 XRP = 1,000,000 drops).
async function refreshBalance(role) {
  try {
    const res = await client.request({
      command: 'account_info',
      account: wallets[role].address,
      ledger_index: 'validated'
    })
    const xrp = (Number(res.result.account_data.Balance) / 1_000_000).toFixed(2)
    document.getElementById(`${role}-bal`).textContent = xrp
  } catch {
    document.getElementById(`${role}-bal`).textContent = 'not funded'
  }
}

async function refreshAllBalances() {
  for (const role of ['seller', 'buyer', 'broker']) {
    if (wallets[role]) await refreshBalance(role)
  }
}

// ─── Faucet ───────────────────────────────────────────────────────────────────

// client.fundWallet() hits the XRPL testnet faucet HTTP endpoint.
// It creates the account on-chain (XRPL accounts need a 10 XRP reserve to activate)
// and deposits ~1000 XRP into it. Only works on testnet / devnet.
async function fundWallet(role) {
  if (!requireClient()) return
  if (!wallets[role]) { log(`load ${role} wallet first`, 'err'); return }
  log(`funding ${role} from faucet…`, 'info')
  try {
    const result = await client.fundWallet(wallets[role])
    wallets[role] = result.wallet
    document.getElementById(`${role}-seed`).value = result.wallet.seed
    document.getElementById(`${role}-addr`).textContent = result.wallet.address
    document.getElementById(`${role}-bal`).textContent  = result.balance
    document.getElementById(`${role}-info`).classList.remove('hidden')
    log(`${role} funded — ${result.wallet.address} (${result.balance} XRP)`, 'ok')
  } catch (e) {
    log(`faucet error (${role}): ${e.message}`, 'err')
  }
}

// ─── Mint NFT ─────────────────────────────────────────────────────────────────

// NFTokenMint creates a new NFT on the ledger owned by the signing account.
// Key fields:
//   NFTokenTaxon — a creator-defined category number (can be anything, we use 0)
//   TransferFee  — royalty percentage in 1/100,000 units (1000 = 1%)
//                  immutable after minting, enforced at consensus on every resale
//   Flags: 8     — tfTransferable, allows the NFT to be sold to third parties
//   URI          — hex-encoded link to the token's metadata (stored on-chain)
//
// client.autofill() fills in Sequence, Fee, LastLedgerSequence automatically.
// wallet.sign()     signs the transaction locally — private key never leaves the browser.
// client.submitAndWait() broadcasts the signed tx and waits for ledger validation.
async function mintNFT() {
  if (!requireClient() || !requireWallet('seller')) return
  const fee = parseInt(document.getElementById('mint-fee').value) || 0
  const uri = toHex(document.getElementById('mint-uri').value.trim())

  log('minting NFT…', 'info')
  try {
    const tx = {
      TransactionType: 'NFTokenMint',
      Account: wallets.seller.address,
      NFTokenTaxon: 0,
      TransferFee: fee,
      Flags: 8,
      URI: uri
    }
    const prepared = await client.autofill(tx)
    const signed   = wallets.seller.sign(prepared)
    const result   = await client.submitAndWait(signed.tx_blob)

    if (result.result.meta.TransactionResult !== 'tesSUCCESS') {
      log(`mint failed: ${result.result.meta.TransactionResult}`, 'err')
      return
    }

    // The NFTokenID is inside the ledger metadata — we look for the NFTokenPage
    // node that was modified/created and diff the NFTokens arrays to find the new one.
    const nftNode = result.result.meta.AffectedNodes?.find(n =>
      n.ModifiedNode?.LedgerEntryType === 'NFTokenPage' ||
      n.CreatedNode?.LedgerEntryType  === 'NFTokenPage'
    )
    const node    = nftNode?.ModifiedNode || nftNode?.CreatedNode
    const newNFTs = node?.FinalFields?.NFTokens || node?.NewFields?.NFTokens || []
    const prevNFTs= node?.PreviousFields?.NFTokens || []
    const minted  = newNFTs.find(n => !prevNFTs.find(p => p.NFToken.NFTokenID === n.NFToken.NFTokenID))
    const id      = minted?.NFToken?.NFTokenID

    if (id) {
      document.getElementById('minted-nft-id').textContent = id
      document.getElementById('minted-nft').classList.remove('hidden')
      document.getElementById('sell-nft-id').value    = id
      document.getElementById('buy-nft-id').value     = id
      document.getElementById('offers-nft-id').value  = id
      log(`minted — ${id}`, 'ok')
    } else {
      log('mint succeeded but NFTokenID not found in metadata — fetch NFTs manually', 'info')
    }
    await refreshBalance('seller')
  } catch (e) {
    log('mint error: ' + e.message, 'err')
  }
}

// ─── View NFTs ────────────────────────────────────────────────────────────────

// account_nfts returns all NFTs currently owned by an address.
// Each entry includes NFTokenID, TransferFee, Flags, URI (hex), NFTokenTaxon.
async function viewNFTs() {
  if (!requireClient()) return
  const addr = document.getElementById('view-addr').value.trim() || wallets.seller?.address
  if (!addr) { log('enter an address or load seller wallet', 'err'); return }

  log(`fetching NFTs for ${addr}…`, 'info')
  try {
    const result = await client.request({ command: 'account_nfts', account: addr })
    const nfts   = result.result.account_nfts
    const container = document.getElementById('nft-list')
    container.innerHTML = ''

    if (!nfts.length) {
      container.innerHTML = '<p class="text-xs text-gray-600">no NFTs found</p>'
      return
    }

    nfts.forEach(nft => {
      const royalty      = (nft.TransferFee / 1000).toFixed(1)
      const transferable = (nft.Flags & 8) !== 0
      const uriDecoded   = nft.URI ? fromHex(nft.URI) : '—'
      const div = document.createElement('div')
      div.className = 'bg-gray-800 rounded p-3 text-xs space-y-1'
      div.innerHTML = `
        <div class="flex items-start justify-between gap-2">
          <span class="text-yellow-400 break-all">${nft.NFTokenID}</span>
          <button onclick="useNFT('${nft.NFTokenID}')"
            class="shrink-0 px-2 py-1 rounded bg-indigo-700 hover:bg-indigo-600 text-xs">use</button>
        </div>
        <div class="text-gray-500">royalty ${royalty}% · transferable: ${transferable}</div>
        <div class="text-gray-600 break-all">${uriDecoded}</div>
      `
      container.appendChild(div)
    })
    log(`${nfts.length} NFT(s) found`, 'ok')
  } catch (e) {
    log('fetch error: ' + e.message, 'err')
  }
}

function useNFT(id) {
  document.getElementById('sell-nft-id').value   = id
  document.getElementById('buy-nft-id').value    = id
  document.getElementById('offers-nft-id').value = id
  log(`NFT selected: ${id}`, 'info')
}

// ─── Sell Offer ───────────────────────────────────────────────────────────────

// NFTokenCreateOffer with Flags: 1 (tfSellNFToken) creates a sell listing.
// Amount is in drops (we convert XRP → drops here).
// Destination is optional — if set, only that address can accept the offer as broker.
// After submission, we extract the offer's ledger index from the metadata
// (it's inside a CreatedNode with LedgerEntryType "NFTokenOffer").
async function createSellOffer() {
  if (!requireClient() || !requireWallet('seller')) return
  const nftokenId   = document.getElementById('sell-nft-id').value.trim()
  const drops       = xrpToDrops(document.getElementById('sell-price').value)
  const destination = document.getElementById('sell-destination').value.trim()
  if (!nftokenId) { log('enter NFTokenID', 'err'); return }

  log(`creating sell offer ${dropsToXrp(drops)} XRP…`, 'info')
  try {
    const tx = {
      TransactionType: 'NFTokenCreateOffer',
      Account: wallets.seller.address,
      NFTokenID: nftokenId,
      Amount: drops,
      Flags: 1
    }
    if (destination) tx.Destination = destination

    const prepared = await client.autofill(tx)
    const signed   = wallets.seller.sign(prepared)
    const result   = await client.submitAndWait(signed.tx_blob)

    if (result.result.meta.TransactionResult !== 'tesSUCCESS') {
      log(`sell offer failed: ${result.result.meta.TransactionResult}`, 'err'); return
    }

    const idx = extractOfferIndex(result.result.meta)
    document.getElementById('sell-offer-index').textContent = idx
    document.getElementById('sell-offer-result').classList.remove('hidden')
    document.getElementById('settle-sell').value = idx
    log(`sell offer created — index: ${idx}`, 'ok')
    await refreshBalance('seller')
  } catch (e) {
    log('sell offer error: ' + e.message, 'err')
  }
}

// ─── Buy Offer ────────────────────────────────────────────────────────────────

// NFTokenCreateOffer without tfSellNFToken creates a buy offer.
// Owner field is required for buy offers — it's the address that currently holds the NFT.
// The buyer is saying "I want to buy NFT X from Owner Y and I'll pay Z drops."
async function createBuyOffer() {
  if (!requireClient() || !requireWallet('buyer')) return
  const nftokenId = document.getElementById('buy-nft-id').value.trim()
  const drops     = xrpToDrops(document.getElementById('buy-price').value)
  const owner     = document.getElementById('buy-owner').value.trim() || wallets.seller?.address
  if (!nftokenId) { log('enter NFTokenID', 'err'); return }
  if (!owner)     { log('enter seller address', 'err'); return }

  log(`creating buy offer ${dropsToXrp(drops)} XRP…`, 'info')
  try {
    const tx = {
      TransactionType: 'NFTokenCreateOffer',
      Account: wallets.buyer.address,
      NFTokenID: nftokenId,
      Amount: drops,
      Owner: owner,
      Flags: 0
    }
    const prepared = await client.autofill(tx)
    const signed   = wallets.buyer.sign(prepared)
    const result   = await client.submitAndWait(signed.tx_blob)

    if (result.result.meta.TransactionResult !== 'tesSUCCESS') {
      log(`buy offer failed: ${result.result.meta.TransactionResult}`, 'err'); return
    }

    const idx = extractOfferIndex(result.result.meta)
    document.getElementById('buy-offer-index').textContent = idx
    document.getElementById('buy-offer-result').classList.remove('hidden')
    document.getElementById('settle-buy').value = idx
    log(`buy offer created — index: ${idx}`, 'ok')
    await refreshBalance('buyer')
  } catch (e) {
    log('buy offer error: ' + e.message, 'err')
  }
}

// ─── Broker Settle ────────────────────────────────────────────────────────────

// NFTokenAcceptOffer in broker mode requires BOTH NFTokenSellOffer and NFTokenBuyOffer.
// The broker account signs this transaction.
//
// NFTokenBrokerFee (optional) — the cut the broker claims from the spread.
//   Must be ≤ (buyer bid − seller ask). If omitted, the broker gets the full spread anyway
//   but it's best practice to set it explicitly.
//
// XRPL then distributes funds atomically in this order:
//   1. Debit buyer
//   2. Credit issuer (TransferFee %)
//   3. Credit broker (NFTokenBrokerFee)
//   4. Credit seller (remainder)
// If any step fails (e.g. buyer doesn't have enough XRP), the whole tx is rejected.
async function brokerSettle() {
  if (!requireClient() || !requireWallet('broker')) return
  const sellIdx    = document.getElementById('settle-sell').value.trim()
  const buyIdx     = document.getElementById('settle-buy').value.trim()
  const feeDrops   = parseInt(document.getElementById('settle-fee').value) || 0
  if (!sellIdx || !buyIdx) { log('enter both offer indexes', 'err'); return }

  log(`settling…`, 'info')
  try {
    const tx = {
      TransactionType: 'NFTokenAcceptOffer',
      Account: wallets.broker.address,
      NFTokenSellOffer: sellIdx,
      NFTokenBuyOffer:  buyIdx
    }
    if (feeDrops > 0) tx.NFTokenBrokerFee = String(feeDrops)

    const prepared = await client.autofill(tx)
    const signed   = wallets.broker.sign(prepared)
    const result   = await client.submitAndWait(signed.tx_blob)

    const code = result.result.meta.TransactionResult
    const hash = result.result.hash

    document.getElementById('settle-result-code').textContent  = code
    document.getElementById('settle-result-code').className    = `font-bold ${code === 'tesSUCCESS' ? 'text-green-400' : 'text-red-400'}`
    document.getElementById('settle-tx-hash').textContent      = hash
    document.getElementById('settle-result').classList.remove('hidden')

    const explorerLink = document.getElementById('settle-explorer-link')
    explorerLink.href  = `https://testnet.xrpl.org/transactions/${hash}`
    explorerLink.classList.remove('hidden')

    if (code === 'tesSUCCESS') {
      log(`settled — tx: ${hash}`, 'ok')
    } else {
      log(`settlement failed: ${code}`, 'err')
    }
    await refreshAllBalances()
  } catch (e) {
    log('settlement error: ' + e.message, 'err')
  }
}

// ─── View Offers ──────────────────────────────────────────────────────────────

// nft_sell_offers and nft_buy_offers return all open offers for a given NFTokenID.
// We run both in parallel with Promise.allSettled so one failing doesn't block the other
// (e.g. if there are no sell offers, that command returns an error — not an empty array).
async function viewOffers() {
  if (!requireClient()) return
  const id = document.getElementById('offers-nft-id').value.trim()
  if (!id) { log('enter NFTokenID', 'err'); return }

  log(`fetching offers for ${id.slice(0, 16)}…`, 'info')
  try {
    const [sellRes, buyRes] = await Promise.allSettled([
      client.request({ command: 'nft_sell_offers', nft_id: id }),
      client.request({ command: 'nft_buy_offers',  nft_id: id })
    ])

    const container = document.getElementById('offers-list')
    container.innerHTML = ''

    const sells = sellRes.status === 'fulfilled' ? sellRes.value.result.offers || [] : []
    const buys  = buyRes.status  === 'fulfilled' ? buyRes.value.result.offers  || [] : []

    if (!sells.length && !buys.length) {
      container.innerHTML = '<p class="text-xs text-gray-600">no offers found</p>'
      log('no offers found', 'info')
      return
    }

    ;[...sells.map(o => ({...o, type:'sell'})), ...buys.map(o => ({...o, type:'buy'}))].forEach(offer => {
      const color = offer.type === 'sell' ? 'text-orange-400' : 'text-sky-400'
      const div = document.createElement('div')
      div.className = 'bg-gray-800 rounded p-3 text-xs space-y-1'
      div.innerHTML = `
        <div class="flex items-center justify-between gap-2">
          <span class="${color} font-bold">${offer.type}</span>
          <span class="text-white">${dropsToXrp(offer.amount)} XRP</span>
          <button onclick="useOfferIndex('${offer.nft_offer_index}','${offer.type}')"
            class="px-2 py-1 rounded bg-gray-600 hover:bg-gray-500 text-xs">use</button>
        </div>
        <div class="text-gray-500 break-all">index: ${offer.nft_offer_index}</div>
        <div class="text-gray-600">owner: ${offer.owner}</div>
      `
      container.appendChild(div)
    })
    log(`${sells.length} sell / ${buys.length} buy`, 'ok')
  } catch (e) {
    log('fetch offers error: ' + e.message, 'err')
  }
}

function useOfferIndex(index, type) {
  if (type === 'sell') document.getElementById('settle-sell').value = index
  else                 document.getElementById('settle-buy').value  = index
  document.getElementById('cancel-offer-index').value = index
  log(`offer index set: ${index}`, 'info')
}

// ─── Cancel Offer ─────────────────────────────────────────────────────────────

// NFTokenCancelOffer removes one or more offers from the ledger.
// NFTokenOffers is an array — you can cancel multiple in one tx.
// Only the offer owner (or the NFT owner for buy offers) can cancel.
async function cancelOffer() {
  if (!requireClient()) return
  const role  = document.getElementById('cancel-wallet').value
  if (!requireWallet(role)) return
  const index = document.getElementById('cancel-offer-index').value.trim()
  if (!index) { log('enter offer index', 'err'); return }

  log(`cancelling offer as ${role}…`, 'info')
  try {
    const tx = {
      TransactionType: 'NFTokenCancelOffer',
      Account: wallets[role].address,
      NFTokenOffers: [index]
    }
    const prepared = await client.autofill(tx)
    const signed   = wallets[role].sign(prepared)
    const result   = await client.submitAndWait(signed.tx_blob)

    const code = result.result.meta.TransactionResult
    if (code === 'tesSUCCESS') log('offer cancelled', 'ok')
    else                       log(`cancel failed: ${code}`, 'err')
  } catch (e) {
    log('cancel error: ' + e.message, 'err')
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fillBrokerAddr()  { if (wallets.broker) document.getElementById('sell-destination').value = wallets.broker.address }
function fillSellerAddr()  { if (wallets.seller) document.getElementById('buy-owner').value = wallets.seller.address }
function fillSellIndex()   { const v = document.getElementById('sell-offer-index').textContent; if (v) document.getElementById('settle-sell').value = v }
function fillBuyIndex()    { const v = document.getElementById('buy-offer-index').textContent;  if (v) document.getElementById('settle-buy').value  = v }

function calcBrokerFee() {
  const ask    = parseFloat(document.getElementById('sell-price').value) || 0
  const bid    = parseFloat(document.getElementById('buy-price').value)  || 0
  const spread = Math.max(0, Math.floor((bid - ask) * 1_000_000))
  document.getElementById('settle-fee').value = spread
  log(`broker fee → ${spread} drops (${(bid - ask).toFixed(4)} XRP spread)`, 'info')
}

// Extracts the NFTokenOffer ledger index from a validated tx's AffectedNodes.
// XRPL metadata contains a list of every ledger object created/modified/deleted.
// CreatedNode with LedgerEntryType "NFTokenOffer" = the newly created offer entry.
function extractOfferIndex(meta) {
  const node = meta.AffectedNodes?.find(n => n.CreatedNode?.LedgerEntryType === 'NFTokenOffer')
  return node?.CreatedNode?.LedgerIndex || '—'
}

// XRPL stores URIs as uppercase hex strings on-chain.
function toHex(str) {
  return Array.from(new TextEncoder().encode(str))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

function fromHex(hex) {
  try {
    return new TextDecoder().decode(new Uint8Array(hex.match(/.{1,2}/g).map(b => parseInt(b, 16))))
  } catch { return hex }
}

function xrpToDrops(xrp) { return String(Math.floor(parseFloat(xrp) * 1_000_000)) }
function dropsToXrp(drops) { return (Number(drops) / 1_000_000).toFixed(4) }

function log(msg, type = 'info') {
  const container = document.getElementById('log')
  const div = document.createElement('div')
  div.className = `log-${type}`
  div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`
  container.prepend(div)
}

function clearLog() { document.getElementById('log').innerHTML = '' }
