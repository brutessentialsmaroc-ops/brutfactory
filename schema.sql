-- ============================================================
-- Schema Supabase : CRM Coûts de Fabrication & Rentabilité
-- A exécuter dans Supabase > SQL Editor
-- ============================================================

-- Extension pour uuid
create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- 1. Matières premières
-- ------------------------------------------------------------
create table if not exists raw_materials (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  unite text not null default 'unité',   -- kg, L, m, unité...
  prix_unitaire numeric(12,2) not null default 0,
  fournisseur text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ------------------------------------------------------------
-- 2. Main d'œuvre (postes de travail / taux horaires)
-- ------------------------------------------------------------
create table if not exists labor_rates (
  id uuid primary key default gen_random_uuid(),
  nom_poste text not null,               -- ex: Couturière, Assemblage, Finition
  taux_horaire numeric(12,2) not null default 0,
  notes text,
  created_at timestamptz default now()
);

-- ------------------------------------------------------------
-- 3. Charges (fixes / variables : loyer, électricité, etc.)
-- ------------------------------------------------------------
create table if not exists overhead_charges (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  type text not null default 'fixe' check (type in ('fixe','variable')),
  montant numeric(12,2) not null default 0,
  periode text default 'mensuel' check (periode in ('mensuel','annuel','unitaire')),
  notes text,
  created_at timestamptz default now()
);

-- ------------------------------------------------------------
-- 4. Catalogue produits
-- ------------------------------------------------------------
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  reference text,
  nom text not null,
  categorie text,
  description text,
  image_url text,
  actif boolean default true,
  created_at timestamptz default now()
);

-- ------------------------------------------------------------
-- 5. Fiche de coût : matières utilisées par produit
-- ------------------------------------------------------------
create table if not exists product_materials (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  material_id uuid not null references raw_materials(id) on delete restrict,
  quantite numeric(12,4) not null default 0
);

-- ------------------------------------------------------------
-- 6. Fiche de coût : main d'œuvre par produit
-- ------------------------------------------------------------
create table if not exists product_labor (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  labor_id uuid not null references labor_rates(id) on delete restrict,
  temps_heures numeric(12,4) not null default 0
);

-- ------------------------------------------------------------
-- 7. Fiche de coût : charges allouées par produit (montant / unité)
-- ------------------------------------------------------------
create table if not exists product_overhead (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  charge_id uuid not null references overhead_charges(id) on delete restrict,
  montant_unitaire numeric(12,2) not null default 0
);

-- ------------------------------------------------------------
-- 8. Historique des prix de vente
-- ------------------------------------------------------------
create table if not exists selling_prices (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  prix_vente numeric(12,2) not null default 0,
  date_effet date default current_date,
  notes text,
  created_at timestamptz default now()
);

-- ------------------------------------------------------------
-- 9. Benchmarking prix concurrents
-- ------------------------------------------------------------
create table if not exists competitor_prices (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  concurrent_nom text not null,
  prix numeric(12,2) not null,
  url_source text,
  date_releve date default current_date,
  notes text,
  created_at timestamptz default now()
);

-- ============================================================
-- Row Level Security : accès réservé aux utilisateurs authentifiés
-- (outil mono/petite-équipe : tout utilisateur connecté a accès complet)
-- ============================================================
alter table raw_materials enable row level security;
alter table labor_rates enable row level security;
alter table overhead_charges enable row level security;
alter table products enable row level security;
alter table product_materials enable row level security;
alter table product_labor enable row level security;
alter table product_overhead enable row level security;
alter table selling_prices enable row level security;
alter table competitor_prices enable row level security;

do $$
declare
  t text;
begin
  for t in select unnest(array[
    'raw_materials','labor_rates','overhead_charges','products',
    'product_materials','product_labor','product_overhead',
    'selling_prices','competitor_prices'
  ])
  loop
    execute format(
      'create policy "authenticated_full_access" on %I for all using (auth.role() = ''authenticated'') with check (auth.role() = ''authenticated'');',
      t
    );
  end loop;
end $$;

-- ============================================================
-- Vue : coût de revient et marge par produit
-- ============================================================
create or replace view product_costing as
select
  p.id as product_id,
  p.nom as produit,
  p.reference,
  p.categorie,
  coalesce(mat.cout_matieres, 0) as cout_matieres,
  coalesce(mo.cout_main_oeuvre, 0) as cout_main_oeuvre,
  coalesce(ov.cout_charges, 0) as cout_charges,
  coalesce(mat.cout_matieres, 0) + coalesce(mo.cout_main_oeuvre, 0) + coalesce(ov.cout_charges, 0) as cout_total,
  sp.prix_vente,
  case when sp.prix_vente is not null then
    sp.prix_vente - (coalesce(mat.cout_matieres,0) + coalesce(mo.cout_main_oeuvre,0) + coalesce(ov.cout_charges,0))
  end as marge_brute,
  case when sp.prix_vente is not null and sp.prix_vente > 0 then
    round(100.0 * (sp.prix_vente - (coalesce(mat.cout_matieres,0) + coalesce(mo.cout_main_oeuvre,0) + coalesce(ov.cout_charges,0))) / sp.prix_vente, 2)
  end as marge_pct
from products p
left join (
  select product_id, sum(quantite * rm.prix_unitaire) as cout_matieres
  from product_materials pm
  join raw_materials rm on rm.id = pm.material_id
  group by product_id
) mat on mat.product_id = p.id
left join (
  select product_id, sum(temps_heures * lr.taux_horaire) as cout_main_oeuvre
  from product_labor pl
  join labor_rates lr on lr.id = pl.labor_id
  group by product_id
) mo on mo.product_id = p.id
left join (
  select product_id, sum(montant_unitaire) as cout_charges
  from product_overhead
  group by product_id
) ov on ov.product_id = p.id
left join lateral (
  select prix_vente from selling_prices sp2
  where sp2.product_id = p.id
  order by date_effet desc, created_at desc
  limit 1
) sp on true;
