# Projet Annuel — Module XRP : Marketplace de Revente NFT

## Contexte du projet

Dans le cadre du cours XRP, notre équipe de deux personnes développe une application décentralisée construite sur le **XRP Ledger (XRPL)**. Le projet est divisé en deux parties complémentaires :

- une plateforme permettant aux détenteurs de NFTs de les revendre, avec application automatique des royalties au créateur original à chaque transaction secondaire.

---

## Notre périmètre : la marketplace de revente

### Problème adressé

Quand quelqu'un achète un NFT (fichier 3D, template, code source…), il peut vouloir le revendre. Sans infrastructure dédiée, cette revente est complexe, opaque, et les créateurs originaux ne touchent rien. Notre marketplace résout ces trois problèmes simultanément.

### Ce que fait la marketplace

La marketplace est une interface web qui :

1. **Affiche les NFTs mis en vente** par leurs propriétaires actuels
2. **Permet à un acheteur de faire une offre** (ou d'accepter un prix fixe)
3. **Exécute la transaction on-chain** en mode broker — notre plateforme joue l'intermédiaire qui matche l'offre du vendeur et celle de l'acheteur
4. **Distribue automatiquement les fonds** en une seule transaction atomique :
   - Le créateur original reçoit ses royalties (définies lors du mint, immutables)
   - Notre plateforme reçoit une commission (écart entre prix vendeur et prix acheteur)
   - Le vendeur reçoit le solde net

---

## Fonctionnement technique (XRPL)

### Les transactions impliquées

Le XRPL expose nativement trois types de transactions pour gérer les NFTs :

| Transaction | Rôle |
|---|---|
| `NFTokenCreateOffer` | Créer une offre de vente ou d'achat |
| `NFTokenAcceptOffer` | Accepter une offre (mode direct ou broker) |
| `NFTokenCancelOffer` | Annuler une offre existante |

### Le mode broker

C'est le cœur de notre marketplace. Plutôt que le vendeur et l'acheteur se trouvent directement, notre plateforme agit comme **broker** :

1. Le vendeur crée une offre de vente (`NFTokenCreateOffer` avec flag `tfSellNFToken`)
2. Un acheteur crée une offre d'achat (`NFTokenCreateOffer` sans flag)
3. Notre backend exécute `NFTokenAcceptOffer` en spécifiant **les deux offres simultanément**
4. Le XRPL distribue les fonds dans cet ordre précis :
   - Débit de l'acheteur
   - Paiement des royalties à l'émetteur (créateur original)
   - Paiement de la commission au broker (notre plateforme)
   - Crédit du vendeur

Tout cela se passe en **une seule transaction atomique** — soit tout réussit, soit rien n'est exécuté.

### Les royalties on-chain

Lors du mint, le créateur définit un `TransferFee` (entre 0 et 50 000 unités, soit 0 % à 50 %). Ce paramètre est **immutable après le mint** — il ne peut pas être modifié ou contourné. Le XRPL l'applique au niveau du consensus, sans que la marketplace ait besoin d'implémenter quoi que ce soit de spécifique.

Exemple concret :
```
NFT mis en vente à 100 XRP, TransferFee = 1000 (1%)
Commission marketplace = 2%

→ Créateur reçoit : 1 XRP (royalty automatique)
→ Marketplace reçoit : 2 XRP (commission broker)
→ Vendeur reçoit : 97 XRP
```

---

## Interface utilisateur

### Pages principales

- **Catalogue** — liste de tous les NFTs actuellement en vente, avec filtres (catégorie, prix, créateur)
- **Fiche NFT** — détail d'un actif : métadonnées, historique de transactions, prix actuel, TransferFee du créateur
- **Vendre un NFT** — formulaire pour définir un prix et soumettre une offre de vente on-chain
- **Faire une offre** — interface pour proposer un prix différent du prix demandé
- **Mon portefeuille** — NFTs détenus, offres en cours, historique d'achats

### Connexion wallet

L'authentification se fait par wallet XRP (Xumm ou wallet compatible XRPL). Pas de compte email, pas de mot de passe — l'identité est cryptographique.

---

## Architecture technique

```
Utilisateur
    │
    ▼
Frontend (Nuxt 3)
    │
    ├── Affichage des NFTs et offres (lecture XRPL via xrpl.js)
    └── Soumission des transactions (signées côté client via wallet)
    │
    ▼
Backend (Node.js / Express)
    │
    ├── Indexation des NFTs et offres (polling XRPL)
    ├── Matching des offres (logique broker)
    ├── Exécution NFTokenAcceptOffer (compte broker signataire)
    └── API REST pour le frontend
    │
    ▼
XRP Ledger (Testnet → Mainnet)
    │
    ├── NFTokenCreateOffer (vendeurs et acheteurs)
    ├── NFTokenAcceptOffer (notre broker)
    └── Distribution automatique des fonds
```

---

## Articulation avec la partie 1 (mint)

Notre binôme mint les NFTs avec les paramètres suivants que notre marketplace consomme :

| Paramètre mint | Usage dans notre marketplace |
|---|---|
| `TransferFee` | Affiché sur la fiche NFT, automatiquement prélevé à chaque revente |
| `Flags: tfTransferable` | Vérifié avant d'afficher le NFT comme revendable |
| `URI` | Métadonnées du fichier (nom, description, aperçu) |
| `NFTokenID` | Identifiant unique utilisé pour toutes nos requêtes XRPL |

---

## Ce que ce projet démontre

- Maîtrise du **mode broker XRPL** pour les transactions NFT secondaires
- Application des **royalties on-chain** sans logique applicative côté plateforme
- Construction d'un **indexeur XRPL** pour suivre les offres en temps réel
- Intégration d'un **wallet XRP** comme système d'authentification
- Séparation claire des responsabilités entre création (binôme) et distribution (notre équipe)

