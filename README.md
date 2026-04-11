# XRP NFT Marketplace

Marketplace de revente de NFTs sur le XRP Ledger en testnet. Le principe : un vendeur et un acheteur créent chacun une offre, et notre compte broker les match en une seule transaction atomique. Les royalties du créateur sont prélevées automatiquement par le ledger.

## Lancer le projet

Ouvrir `xrp-marketplace.html` directement dans un navigateur. Aucun serveur nécessaire.

## Étapes pour tester

1. Cliquer **Connect** — attendre le point vert en haut à droite
2. Dans chaque carte (Seller, Buyer, Broker), laisser le champ seed vide et cliquer **Load / Generate**
3. Cliquer **Fund Seller**, **Fund Buyer**, **Fund Broker** et attendre quelques secondes à chaque fois (faucet testnet)
4. Remplir un URI ou laisser la valeur par défaut, cliquer **Mint NFT**
5. Le NFTokenID se remplit automatiquement — définir un prix vendeur et cliquer **Create Sell Offer**
6. Cliquer **← seller addr** pour remplir l'adresse, définir un montant acheteur (≥ prix vendeur), cliquer **Create Buy Offer**
7. Cliquer **auto** pour calculer la commission broker, puis **Settle Transaction**
8. Le log affiche le résultat et un lien vers l'explorateur testnet pour vérifier la transaction

## Stack

- XRP Ledger testnet via xrpl.js
- HTML + Tailwind CSS + JavaScript
