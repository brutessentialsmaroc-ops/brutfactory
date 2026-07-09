# Coûts & Rentabilité — CRM sur mesure

Application web (HTML/JS + Supabase) pour calculer le coût de revient de tes produits, suivre ta rentabilité et comparer tes prix à la concurrence.

Fonctionnalités :
- Matières premières, main d'œuvre, charges (référentiels réutilisables)
- Catalogue produits avec fiche de coût par produit (matières + MO + charges)
- Historique des prix de vente, calcul automatique de marge et marge %
- Benchmarking prix concurrents, par produit et vue globale
- Tableau de bord rentabilité (marge moyenne, produits en perte, écart vs concurrence)
- Connexion par email/mot de passe (Supabase Auth), données protégées par RLS

Aucun framework, aucun build : juste des fichiers statiques + Supabase.

---

## 1. Créer le projet Supabase

1. Va sur [supabase.com](https://supabase.com) → **New project**.
2. Une fois le projet créé, ouvre **SQL Editor** → colle le contenu de `schema.sql` → **Run**.
   Cela crée toutes les tables, active la sécurité RLS et crée la vue `product_costing` qui calcule automatiquement coût et marge.
3. Va dans **Authentication > Providers** → vérifie que **Email** est activé (c'est le cas par défaut).
   - Optionnel : dans **Authentication > Settings**, tu peux désactiver "Confirm email" pour te connecter immédiatement après inscription (pratique en solo).
4. Va dans **Project Settings > API** → copie :
   - `Project URL`
   - `anon public` key

## 2. Configurer l'application

Ouvre `config.js` et remplace :

```js
const SUPABASE_URL = "https://VOTRE-PROJET.supabase.co";
const SUPABASE_ANON_KEY = "VOTRE_CLE_ANON_PUBLIQUE";
const CURRENCY = "DH"; // change en "€", "$", etc. si besoin
```

La clé `anon` est publique par design (utilisée côté navigateur) : la vraie protection vient des policies RLS définies dans `schema.sql`, qui n'autorisent que les utilisateurs connectés.

## 3. Tester en local

Depuis ce dossier :

```bash
python3 -m http.server 8080
```

Puis ouvre `http://localhost:8080`. Crée ton compte via "Créer un compte" sur l'écran de connexion (utilise ton email), connecte-toi, et commence à saisir tes matières, main d'œuvre, charges et produits.

## 4. Mettre sur GitHub

```bash
cd manufacturing-crm
git init
git add .
git commit -m "Initial commit — CRM coûts & rentabilité"
git branch -M main
git remote add origin https://github.com/TON-COMPTE/TON-REPO.git
git push -u origin main
```

⚠️ `config.js` contient tes identifiants Supabase (URL + clé anon). Comme expliqué ci-dessus, la clé anon seule n'est pas un secret critique tant que la RLS est active, mais si tu préfères ne pas la committer :
- ajoute `config.js` à un `.gitignore`,
- garde une copie `config.example.js` sans les vraies valeurs pour référence,
- et renseigne `config.js` manuellement à chaque déploiement.

## 5. Déployer (hébergement statique gratuit)

N'importe quel hébergeur de fichiers statiques fonctionne. Les plus simples :

**GitHub Pages**
- Repo → Settings → Pages → Source: branche `main`, dossier `/ (root)`.
- L'app sera disponible sur `https://TON-COMPTE.github.io/TON-REPO/`.

**Netlify / Vercel**
- Importe le repo GitHub, aucun "build command" nécessaire (site statique), publish directory = racine du repo.

## Structure des fichiers

```
manufacturing-crm/
├── index.html      Structure de l'app (écran de connexion + onglets)
├── style.css        Mise en forme
├── app.js           Toute la logique (auth, CRUD, calculs, rendu)
├── config.js         Identifiants Supabase + devise (à personnaliser)
└── schema.sql       Script SQL à exécuter une fois dans Supabase
```

## Modèle de données (résumé)

- `raw_materials` — matières premières (nom, unité, prix unitaire, fournisseur)
- `labor_rates` — postes de main d'œuvre (nom, taux horaire)
- `overhead_charges` — charges fixes/variables (loyer, électricité, etc.)
- `products` — catalogue produits
- `product_materials` / `product_labor` / `product_overhead` — composition de la fiche de coût d'un produit
- `selling_prices` — historique des prix de vente par produit
- `competitor_prices` — relevés de prix concurrents par produit
- `product_costing` (vue) — calcule automatiquement coût matières, coût MO, charges, coût total, marge et marge % pour chaque produit

## Évolutions possibles

- Export CSV/Excel du tableau de bord
- Gestion de plusieurs unités de vente (B2B/B2C, packs)
- Alertes automatiques si la marge passe sous un seuil
- Multi-devises
- Rôles utilisateurs (lecture seule vs édition)
