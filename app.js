// ============================================================
// Coûts & Rentabilité — logique applicative
// ============================================================

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function fmtMoney(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return Number(n).toFixed(2) + " " + CURRENCY;
}
function fmtPct(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return Number(n).toFixed(1) + " %";
}
function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("fr-FR");
}

// Cache local des référentiels
const cache = { materials: [], labor: [], charges: [], products: [] };

// ============================================================
// AUTH
// ============================================================

let authMode = "signin"; // ou "signup"

qs("#auth-toggle").addEventListener("click", () => {
  authMode = authMode === "signin" ? "signup" : "signin";
  qs("#auth-submit").textContent = authMode === "signin" ? "Se connecter" : "Créer le compte";
  qs("#auth-toggle").textContent = authMode === "signin" ? "Créer un compte" : "J'ai déjà un compte";
});

qs("#auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = qs("#auth-email").value.trim();
  const password = qs("#auth-password").value;
  const errBox = qs("#auth-error");
  errBox.textContent = "";

  const { data, error } =
    authMode === "signin"
      ? await sb.auth.signInWithPassword({ email, password })
      : await sb.auth.signUp({ email, password });

  if (error) {
    errBox.textContent = error.message;
    return;
  }
  if (authMode === "signup" && !data.session) {
    errBox.textContent = "Compte créé. Vérifie ta boîte mail pour confirmer, puis connecte-toi.";
    return;
  }
  await onAuthed(data.session);
});

qs("#logout-btn").addEventListener("click", async () => {
  await sb.auth.signOut();
  location.reload();
});

async function onAuthed(session) {
  qs("#auth-screen").hidden = true;
  qs("#app").hidden = false;
  qs("#user-email").textContent = session.user.email;
  await loadAllReferenceData();
  await renderDashboard();
}

(async function initAuth() {
  const { data } = await sb.auth.getSession();
  if (data.session) {
    await onAuthed(data.session);
  }
})();

// ============================================================
// NAVIGATION (onglets)
// ============================================================

qsa(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => showView(btn.dataset.view));
});
qs("#back-to-catalogue").addEventListener("click", () => showView("catalogue"));

async function showView(name) {
  qsa(".view").forEach((v) => v.classList.remove("active"));
  qsa(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  const target = qs("#view-" + name);
  if (target) target.classList.add("active");

  if (name === "dashboard") await renderDashboard();
  if (name === "catalogue") renderProductsTable();
  if (name === "materials") renderMaterialsTable();
  if (name === "labor") renderLaborTable();
  if (name === "charges") renderChargesTable();
  if (name === "benchmarking") await renderBenchmarkingTable();
}

// ============================================================
// MODALE GENERIQUE (formulaire add/edit)
// ============================================================

let modalOnSave = null;

function openFormModal({ title, fields, initialValues = {}, onSave }) {
  qs("#modal-title").textContent = title;
  const body = qs("#modal-body");
  body.innerHTML = "";

  fields.forEach((f) => {
    const wrap = document.createElement("label");
    wrap.textContent = f.label;
    let input;
    if (f.type === "select") {
      input = document.createElement("select");
      (f.options || []).forEach((opt) => {
        const o = document.createElement("option");
        o.value = opt.value;
        o.textContent = opt.label;
        input.appendChild(o);
      });
    } else if (f.type === "textarea") {
      input = document.createElement("textarea");
      input.rows = 2;
    } else {
      input = document.createElement("input");
      input.type = f.type || "text";
      if (f.step) input.step = f.step;
    }
    input.id = "modal-field-" + f.key;
    if (initialValues[f.key] !== undefined && initialValues[f.key] !== null) {
      input.value = initialValues[f.key];
    }
    if (f.type === "checkbox") {
      input.type = "checkbox";
      input.checked = !!initialValues[f.key];
      wrap.classList.add("checkbox-row");
      wrap.innerHTML = "";
      wrap.appendChild(input);
      wrap.append(" " + f.label);
    } else {
      wrap.appendChild(input);
    }
    body.appendChild(wrap);
  });

  modalOnSave = () => {
    const values = {};
    fields.forEach((f) => {
      const input = qs("#modal-field-" + f.key);
      if (f.type === "checkbox") values[f.key] = input.checked;
      else if (f.type === "number") values[f.key] = input.value === "" ? 0 : Number(input.value);
      else values[f.key] = input.value;
    });
    onSave(values);
    closeModal();
  };

  qs("#modal-overlay").hidden = false;
}

function closeModal() {
  qs("#modal-overlay").hidden = true;
  modalOnSave = null;
}

qs("#modal-cancel").addEventListener("click", closeModal);
qs("#modal-save").addEventListener("click", () => modalOnSave && modalOnSave());

// ============================================================
// CHARGEMENT DES REFERENTIELS
// ============================================================

async function loadAllReferenceData() {
  const [mats, lab, chg, prods] = await Promise.all([
    sb.from("raw_materials").select("*").order("nom"),
    sb.from("labor_rates").select("*").order("nom_poste"),
    sb.from("overhead_charges").select("*").order("nom"),
    sb.from("products").select("*").order("nom"),
  ]);
  cache.materials = mats.data || [];
  cache.labor = lab.data || [];
  cache.charges = chg.data || [];
  cache.products = prods.data || [];

  renderMaterialsTable();
  renderLaborTable();
  renderChargesTable();
  renderProductsTable();
}

// ============================================================
// MATIERES PREMIERES
// ============================================================

function renderMaterialsTable() {
  const tbody = qs("#materials-table tbody");
  tbody.innerHTML = "";
  cache.materials.forEach((m) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(m.nom)}</td>
      <td>${escapeHtml(m.unite)}</td>
      <td>${fmtMoney(m.prix_unitaire)}</td>
      <td>${escapeHtml(m.fournisseur || "")}</td>
      <td>
        <button class="icon-btn edit-mat" data-id="${m.id}">✎</button>
        <button class="icon-btn del-mat" data-id="${m.id}">🗑</button>
      </td>`;
    tbody.appendChild(tr);
  });

  qsa(".edit-mat").forEach((b) =>
    b.addEventListener("click", () => editMaterial(b.dataset.id))
  );
  qsa(".del-mat").forEach((b) =>
    b.addEventListener("click", () => deleteMaterial(b.dataset.id))
  );
}

const materialFields = [
  { key: "nom", label: "Nom", type: "text" },
  { key: "unite", label: "Unité (kg, L, m, unité...)", type: "text" },
  { key: "prix_unitaire", label: "Prix unitaire", type: "number", step: "0.01" },
  { key: "fournisseur", label: "Fournisseur", type: "text" },
  { key: "notes", label: "Notes", type: "textarea" },
];

qs("#add-material-btn").addEventListener("click", () => {
  openFormModal({
    title: "Nouvelle matière première",
    fields: materialFields,
    onSave: async (values) => {
      const { error } = await sb.from("raw_materials").insert(values);
      if (error) return alert(error.message);
      await loadAllReferenceData();
    },
  });
});

function editMaterial(id) {
  const m = cache.materials.find((x) => x.id === id);
  openFormModal({
    title: "Modifier la matière",
    fields: materialFields,
    initialValues: m,
    onSave: async (values) => {
      const { error } = await sb.from("raw_materials").update(values).eq("id", id);
      if (error) return alert(error.message);
      await loadAllReferenceData();
    },
  });
}

async function deleteMaterial(id) {
  if (!confirm("Supprimer cette matière ?")) return;
  const { error } = await sb.from("raw_materials").delete().eq("id", id);
  if (error) return alert(error.message);
  await loadAllReferenceData();
}

// ============================================================
// MAIN D'OEUVRE
// ============================================================

function renderLaborTable() {
  const tbody = qs("#labor-table tbody");
  tbody.innerHTML = "";
  cache.labor.forEach((l) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(l.nom_poste)}</td>
      <td>${fmtMoney(l.taux_horaire)} / h</td>
      <td>${escapeHtml(l.notes || "")}</td>
      <td>
        <button class="icon-btn edit-lab" data-id="${l.id}">✎</button>
        <button class="icon-btn del-lab" data-id="${l.id}">🗑</button>
      </td>`;
    tbody.appendChild(tr);
  });
  qsa(".edit-lab").forEach((b) => b.addEventListener("click", () => editLabor(b.dataset.id)));
  qsa(".del-lab").forEach((b) => b.addEventListener("click", () => deleteLabor(b.dataset.id)));
}

const laborFields = [
  { key: "nom_poste", label: "Poste (ex: Couturière, Assemblage)", type: "text" },
  { key: "taux_horaire", label: "Taux horaire", type: "number", step: "0.01" },
  { key: "notes", label: "Notes", type: "textarea" },
];

qs("#add-labor-btn").addEventListener("click", () => {
  openFormModal({
    title: "Nouveau poste de main d'œuvre",
    fields: laborFields,
    onSave: async (values) => {
      const { error } = await sb.from("labor_rates").insert(values);
      if (error) return alert(error.message);
      await loadAllReferenceData();
    },
  });
});

function editLabor(id) {
  const l = cache.labor.find((x) => x.id === id);
  openFormModal({
    title: "Modifier le poste",
    fields: laborFields,
    initialValues: l,
    onSave: async (values) => {
      const { error } = await sb.from("labor_rates").update(values).eq("id", id);
      if (error) return alert(error.message);
      await loadAllReferenceData();
    },
  });
}

async function deleteLabor(id) {
  if (!confirm("Supprimer ce poste ?")) return;
  const { error } = await sb.from("labor_rates").delete().eq("id", id);
  if (error) return alert(error.message);
  await loadAllReferenceData();
}

// ============================================================
// CHARGES
// ============================================================

function renderChargesTable() {
  const tbody = qs("#charges-table tbody");
  tbody.innerHTML = "";
  cache.charges.forEach((c) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(c.nom)}</td>
      <td>${c.type}</td>
      <td>${fmtMoney(c.montant)}</td>
      <td>${c.periode}</td>
      <td>
        <button class="icon-btn edit-chg" data-id="${c.id}">✎</button>
        <button class="icon-btn del-chg" data-id="${c.id}">🗑</button>
      </td>`;
    tbody.appendChild(tr);
  });
  qsa(".edit-chg").forEach((b) => b.addEventListener("click", () => editCharge(b.dataset.id)));
  qsa(".del-chg").forEach((b) => b.addEventListener("click", () => deleteCharge(b.dataset.id)));
}

const chargeFields = [
  { key: "nom", label: "Nom (ex: Loyer, Électricité)", type: "text" },
  {
    key: "type",
    label: "Type",
    type: "select",
    options: [
      { value: "fixe", label: "Fixe" },
      { value: "variable", label: "Variable" },
    ],
  },
  { key: "montant", label: "Montant", type: "number", step: "0.01" },
  {
    key: "periode",
    label: "Période",
    type: "select",
    options: [
      { value: "mensuel", label: "Mensuel" },
      { value: "annuel", label: "Annuel" },
      { value: "unitaire", label: "Par unité produite" },
    ],
  },
  { key: "notes", label: "Notes", type: "textarea" },
];

qs("#add-charge-btn").addEventListener("click", () => {
  openFormModal({
    title: "Nouvelle charge",
    fields: chargeFields,
    initialValues: { type: "fixe", periode: "mensuel" },
    onSave: async (values) => {
      const { error } = await sb.from("overhead_charges").insert(values);
      if (error) return alert(error.message);
      await loadAllReferenceData();
    },
  });
});

function editCharge(id) {
  const c = cache.charges.find((x) => x.id === id);
  openFormModal({
    title: "Modifier la charge",
    fields: chargeFields,
    initialValues: c,
    onSave: async (values) => {
      const { error } = await sb.from("overhead_charges").update(values).eq("id", id);
      if (error) return alert(error.message);
      await loadAllReferenceData();
    },
  });
}

async function deleteCharge(id) {
  if (!confirm("Supprimer cette charge ?")) return;
  const { error } = await sb.from("overhead_charges").delete().eq("id", id);
  if (error) return alert(error.message);
  await loadAllReferenceData();
}

// ============================================================
// CATALOGUE PRODUITS
// ============================================================

function renderProductsTable() {
  const tbody = qs("#products-table tbody");
  tbody.innerHTML = "";
  cache.products.forEach((p) => {
    const tr = document.createElement("tr");
    tr.classList.add("clickable");
    tr.innerHTML = `
      <td>${escapeHtml(p.reference || "")}</td>
      <td>${escapeHtml(p.nom)}</td>
      <td>${escapeHtml(p.categorie || "")}</td>
      <td>${p.actif ? "Oui" : "Non"}</td>
      <td><button class="icon-btn del-prod" data-id="${p.id}">🗑</button></td>`;
    tr.addEventListener("click", (e) => {
      if (e.target.closest(".del-prod")) return;
      openProductDetail(p.id);
    });
    tbody.appendChild(tr);
  });
  qsa(".del-prod").forEach((b) =>
    b.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Supprimer ce produit et toutes ses données associées ?")) return;
      const { error } = await sb.from("products").delete().eq("id", b.dataset.id);
      if (error) return alert(error.message);
      await loadAllReferenceData();
    })
  );
}

qs("#add-product-btn").addEventListener("click", () => {
  openFormModal({
    title: "Nouveau produit",
    fields: [
      { key: "reference", label: "Référence", type: "text" },
      { key: "nom", label: "Nom", type: "text" },
      { key: "categorie", label: "Catégorie", type: "text" },
    ],
    onSave: async (values) => {
      const { data, error } = await sb.from("products").insert(values).select().single();
      if (error) return alert(error.message);
      await loadAllReferenceData();
      openProductDetail(data.id);
    },
  });
});

// ============================================================
// FICHE PRODUIT (détail)
// ============================================================

let currentProductId = null;

async function openProductDetail(productId) {
  currentProductId = productId;
  showView("product-detail");
  await refreshProductDetail();
}

async function refreshProductDetail() {
  const p = cache.products.find((x) => x.id === currentProductId);
  if (!p) return;

  qs("#pd-title").textContent = "Fiche produit — " + p.nom;
  qs("#pd-reference").value = p.reference || "";
  qs("#pd-nom").value = p.nom || "";
  qs("#pd-categorie").value = p.categorie || "";
  qs("#pd-description").value = p.description || "";
  qs("#pd-actif").checked = !!p.actif;

  // Selects
  fillSelect(
    "#pd-material-select",
    cache.materials.map((m) => ({ value: m.id, label: `${m.nom} (${fmtMoney(m.prix_unitaire)}/${m.unite})` }))
  );
  fillSelect(
    "#pd-labor-select",
    cache.labor.map((l) => ({ value: l.id, label: `${l.nom_poste} (${fmtMoney(l.taux_horaire)}/h)` }))
  );
  fillSelect(
    "#pd-charge-select",
    cache.charges.map((c) => ({ value: c.id, label: `${c.nom} (${c.type}, ${c.periode})` }))
  );

  const [pm, pl, po, sp, cp] = await Promise.all([
    sb.from("product_materials").select("*").eq("product_id", currentProductId),
    sb.from("product_labor").select("*").eq("product_id", currentProductId),
    sb.from("product_overhead").select("*").eq("product_id", currentProductId),
    sb.from("selling_prices").select("*").eq("product_id", currentProductId).order("date_effet", { ascending: false }),
    sb.from("competitor_prices").select("*").eq("product_id", currentProductId).order("date_releve", { ascending: false }),
  ]);

  renderProductMaterials(pm.data || []);
  renderProductLabor(pl.data || []);
  renderProductCharges(po.data || []);
  renderProductPrices(sp.data || []);
  renderProductCompetitors(cp.data || []);
  renderCostBreakdown(pm.data || [], pl.data || [], po.data || [], sp.data && sp.data[0]);
}

function fillSelect(sel, options) {
  const el = qs(sel);
  el.innerHTML = options.map((o) => `<option value="${o.value}">${escapeHtml(o.label)}</option>`).join("");
}

qs("#pd-save-info").addEventListener("click", async () => {
  const values = {
    reference: qs("#pd-reference").value,
    nom: qs("#pd-nom").value,
    categorie: qs("#pd-categorie").value,
    description: qs("#pd-description").value,
    actif: qs("#pd-actif").checked,
  };
  const { error } = await sb.from("products").update(values).eq("id", currentProductId);
  if (error) return alert(error.message);
  await loadAllReferenceData();
  await refreshProductDetail();
});

qs("#pd-delete-product").addEventListener("click", async () => {
  if (!confirm("Supprimer définitivement ce produit ?")) return;
  const { error } = await sb.from("products").delete().eq("id", currentProductId);
  if (error) return alert(error.message);
  await loadAllReferenceData();
  showView("catalogue");
});

// ---- Matières du produit ----
function renderProductMaterials(rows) {
  const tbody = qs("#pd-materials-body");
  tbody.innerHTML = "";
  rows.forEach((r) => {
    const mat = cache.materials.find((m) => m.id === r.material_id);
    const sousTotal = mat ? mat.prix_unitaire * r.quantite : 0;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(mat ? mat.nom : "?")}</td>
      <td>${r.quantite} ${mat ? mat.unite : ""}</td>
      <td>${mat ? fmtMoney(mat.prix_unitaire) : "—"}</td>
      <td>${fmtMoney(sousTotal)}</td>
      <td><button class="icon-btn del-pm" data-id="${r.id}">🗑</button></td>`;
    tbody.appendChild(tr);
  });
  qsa(".del-pm").forEach((b) =>
    b.addEventListener("click", async () => {
      await sb.from("product_materials").delete().eq("id", b.dataset.id);
      await refreshProductDetail();
    })
  );
}

qs("#pd-add-material").addEventListener("click", async () => {
  const material_id = qs("#pd-material-select").value;
  const quantite = Number(qs("#pd-material-qty").value || 0);
  if (!material_id || quantite <= 0) return alert("Choisis une matière et une quantité > 0.");
  const { error } = await sb.from("product_materials").insert({ product_id: currentProductId, material_id, quantite });
  if (error) return alert(error.message);
  qs("#pd-material-qty").value = "";
  await refreshProductDetail();
});

// ---- Main d'œuvre du produit ----
function renderProductLabor(rows) {
  const tbody = qs("#pd-labor-body");
  tbody.innerHTML = "";
  rows.forEach((r) => {
    const lab = cache.labor.find((l) => l.id === r.labor_id);
    const sousTotal = lab ? lab.taux_horaire * r.temps_heures : 0;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(lab ? lab.nom_poste : "?")}</td>
      <td>${r.temps_heures} h</td>
      <td>${lab ? fmtMoney(lab.taux_horaire) : "—"}</td>
      <td>${fmtMoney(sousTotal)}</td>
      <td><button class="icon-btn del-pl" data-id="${r.id}">🗑</button></td>`;
    tbody.appendChild(tr);
  });
  qsa(".del-pl").forEach((b) =>
    b.addEventListener("click", async () => {
      await sb.from("product_labor").delete().eq("id", b.dataset.id);
      await refreshProductDetail();
    })
  );
}

qs("#pd-add-labor").addEventListener("click", async () => {
  const labor_id = qs("#pd-labor-select").value;
  const temps_heures = Number(qs("#pd-labor-hours").value || 0);
  if (!labor_id || temps_heures <= 0) return alert("Choisis un poste et un temps > 0.");
  const { error } = await sb.from("product_labor").insert({ product_id: currentProductId, labor_id, temps_heures });
  if (error) return alert(error.message);
  qs("#pd-labor-hours").value = "";
  await refreshProductDetail();
});

// ---- Charges allouées du produit ----
function renderProductCharges(rows) {
  const tbody = qs("#pd-charges-body");
  tbody.innerHTML = "";
  rows.forEach((r) => {
    const chg = cache.charges.find((c) => c.id === r.charge_id);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(chg ? chg.nom : "?")}</td>
      <td>${fmtMoney(r.montant_unitaire)}</td>
      <td><button class="icon-btn del-po" data-id="${r.id}">🗑</button></td>`;
    tbody.appendChild(tr);
  });
  qsa(".del-po").forEach((b) =>
    b.addEventListener("click", async () => {
      await sb.from("product_overhead").delete().eq("id", b.dataset.id);
      await refreshProductDetail();
    })
  );
}

qs("#pd-add-charge").addEventListener("click", async () => {
  const charge_id = qs("#pd-charge-select").value;
  const montant_unitaire = Number(qs("#pd-charge-amount").value || 0);
  if (!charge_id || montant_unitaire <= 0) return alert("Choisis une charge et un montant > 0.");
  const { error } = await sb.from("product_overhead").insert({ product_id: currentProductId, charge_id, montant_unitaire });
  if (error) return alert(error.message);
  qs("#pd-charge-amount").value = "";
  await refreshProductDetail();
});

// ---- Prix de vente ----
function renderProductPrices(rows) {
  const tbody = qs("#pd-prices-body");
  tbody.innerHTML = "";
  rows.forEach((r) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${fmtMoney(r.prix_vente)}</td>
      <td>${fmtDate(r.date_effet)}</td>
      <td><button class="icon-btn del-sp" data-id="${r.id}">🗑</button></td>`;
    tbody.appendChild(tr);
  });
  qsa(".del-sp").forEach((b) =>
    b.addEventListener("click", async () => {
      await sb.from("selling_prices").delete().eq("id", b.dataset.id);
      await refreshProductDetail();
    })
  );
}

qs("#pd-add-price").addEventListener("click", async () => {
  const prix_vente = Number(qs("#pd-price-input").value || 0);
  const date_effet = qs("#pd-price-date").value || new Date().toISOString().slice(0, 10);
  if (prix_vente <= 0) return alert("Renseigne un prix de vente > 0.");
  const { error } = await sb.from("selling_prices").insert({ product_id: currentProductId, prix_vente, date_effet });
  if (error) return alert(error.message);
  qs("#pd-price-input").value = "";
  await refreshProductDetail();
});

// ---- Benchmarking concurrents (par produit) ----
function renderProductCompetitors(rows) {
  const tbody = qs("#pd-competitors-body");
  tbody.innerHTML = "";
  rows.forEach((r) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(r.concurrent_nom)}</td>
      <td>${fmtMoney(r.prix)}</td>
      <td>${fmtDate(r.date_releve)}</td>
      <td>${r.url_source ? `<a href="${escapeHtml(r.url_source)}" target="_blank" rel="noopener">lien</a>` : "—"}</td>
      <td><button class="icon-btn del-cp" data-id="${r.id}">🗑</button></td>`;
    tbody.appendChild(tr);
  });
  qsa(".del-cp").forEach((b) =>
    b.addEventListener("click", async () => {
      await sb.from("competitor_prices").delete().eq("id", b.dataset.id);
      await refreshProductDetail();
    })
  );
}

qs("#pd-add-competitor").addEventListener("click", async () => {
  const concurrent_nom = qs("#pd-comp-name").value.trim();
  const prix = Number(qs("#pd-comp-price").value || 0);
  const url_source = qs("#pd-comp-url").value.trim();
  if (!concurrent_nom || prix <= 0) return alert("Renseigne le nom du concurrent et un prix > 0.");
  const { error } = await sb
    .from("competitor_prices")
    .insert({ product_id: currentProductId, concurrent_nom, prix, url_source: url_source || null });
  if (error) return alert(error.message);
  qs("#pd-comp-name").value = "";
  qs("#pd-comp-price").value = "";
  qs("#pd-comp-url").value = "";
  await refreshProductDetail();
});

// ---- Calcul du coût de revient (affiché dans la fiche produit) ----
function renderCostBreakdown(materials, labor, overhead, latestPrice) {
  const coutMatieres = materials.reduce((sum, r) => {
    const mat = cache.materials.find((m) => m.id === r.material_id);
    return sum + (mat ? mat.prix_unitaire * r.quantite : 0);
  }, 0);
  const coutMO = labor.reduce((sum, r) => {
    const lab = cache.labor.find((l) => l.id === r.labor_id);
    return sum + (lab ? lab.taux_horaire * r.temps_heures : 0);
  }, 0);
  const coutCharges = overhead.reduce((sum, r) => sum + Number(r.montant_unitaire), 0);
  const coutTotal = coutMatieres + coutMO + coutCharges;
  const prixVente = latestPrice ? Number(latestPrice.prix_vente) : null;
  const marge = prixVente !== null ? prixVente - coutTotal : null;
  const margePct = prixVente ? (marge / prixVente) * 100 : null;

  qs("#pd-cost-breakdown").innerHTML = `
    <div class="row"><span>Coût matières</span><span>${fmtMoney(coutMatieres)}</span></div>
    <div class="row"><span>Coût main d'œuvre</span><span>${fmtMoney(coutMO)}</span></div>
    <div class="row"><span>Charges allouées</span><span>${fmtMoney(coutCharges)}</span></div>
    <div class="row total"><span>Coût de revient total</span><span>${fmtMoney(coutTotal)}</span></div>
    <div class="row"><span>Prix de vente actuel</span><span>${prixVente !== null ? fmtMoney(prixVente) : "—"}</span></div>
    <div class="row"><span>Marge brute</span><span class="${marge !== null && marge < 0 ? "negative" : "positive"}">${
    marge !== null ? fmtMoney(marge) : "—"
  }</span></div>
    <div class="row"><span>Marge %</span><span class="${margePct !== null && margePct < 0 ? "negative" : "positive"}">${
    margePct !== null ? fmtPct(margePct) : "—"
  }</span></div>
  `;
}

// ============================================================
// DASHBOARD
// ============================================================

async function renderDashboard() {
  const { data: costing, error } = await sb.from("product_costing").select("*");
  if (error) {
    console.error(error);
    return;
  }
  const { data: competitors } = await sb.from("competitor_prices").select("product_id, prix");

  const avgByProduct = {};
  (competitors || []).forEach((c) => {
    if (!avgByProduct[c.product_id]) avgByProduct[c.product_id] = [];
    avgByProduct[c.product_id].push(Number(c.prix));
  });

  const rows = (costing || []).map((r) => {
    const prices = avgByProduct[r.product_id] || [];
    const avgConcurrent = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
    const ecart = r.prix_vente && avgConcurrent ? r.prix_vente - avgConcurrent : null;
    return { ...r, avgConcurrent, ecart };
  });

  // KPIs
  const produitsActifs = cache.products.filter((p) => p.actif).length;
  const margesValides = rows.filter((r) => r.marge_pct !== null && r.marge_pct !== undefined);
  const margeMoyenne = margesValides.length
    ? margesValides.reduce((a, r) => a + Number(r.marge_pct), 0) / margesValides.length
    : null;
  const produitsEnPerte = rows.filter((r) => r.marge_brute !== null && Number(r.marge_brute) < 0).length;
  const ecartsValides = rows.filter((r) => r.ecart !== null);
  const ecartMoyen = ecartsValides.length
    ? ecartsValides.reduce((a, r) => a + Number(r.ecart), 0) / ecartsValides.length
    : null;

  qs("#kpi-row").innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">Produits actifs</div>
      <div class="kpi-value">${produitsActifs}</div>
    </div>
    <div class="kpi-card ${margeMoyenne !== null && margeMoyenne < 0 ? "warn" : "good"}">
      <div class="kpi-label">Marge moyenne</div>
      <div class="kpi-value">${margeMoyenne !== null ? fmtPct(margeMoyenne) : "—"}</div>
    </div>
    <div class="kpi-card ${produitsEnPerte > 0 ? "warn" : "good"}">
      <div class="kpi-label">Produits en perte</div>
      <div class="kpi-value">${produitsEnPerte}</div>
    </div>
    <div class="kpi-card ${ecartMoyen !== null && ecartMoyen < 0 ? "warn" : "good"}">
      <div class="kpi-label">Écart moyen vs concurrence</div>
      <div class="kpi-value">${ecartMoyen !== null ? fmtMoney(ecartMoyen) : "—"}</div>
    </div>
  `;

  const tbody = qs("#dashboard-table tbody");
  tbody.innerHTML = "";
  rows.forEach((r) => {
    const tr = document.createElement("tr");
    tr.classList.add("clickable");
    tr.innerHTML = `
      <td>${escapeHtml(r.produit)}</td>
      <td>${fmtMoney(r.cout_matieres)}</td>
      <td>${fmtMoney(r.cout_main_oeuvre)}</td>
      <td>${fmtMoney(r.cout_charges)}</td>
      <td>${fmtMoney(r.cout_total)}</td>
      <td>${r.prix_vente !== null ? fmtMoney(r.prix_vente) : "—"}</td>
      <td class="${r.marge_brute !== null && r.marge_brute < 0 ? "negative" : "positive"}">${
      r.marge_brute !== null ? fmtMoney(r.marge_brute) : "—"
    }</td>
      <td class="${r.marge_pct !== null && r.marge_pct < 0 ? "negative" : "positive"}">${
      r.marge_pct !== null ? fmtPct(r.marge_pct) : "—"
    }</td>
      <td>${r.avgConcurrent !== null ? fmtMoney(r.avgConcurrent) : "—"}</td>
      <td class="${r.ecart !== null && r.ecart < 0 ? "negative" : "positive"}">${
      r.ecart !== null ? fmtMoney(r.ecart) : "—"
    }</td>`;
    tr.addEventListener("click", () => openProductDetail(r.product_id));
    tbody.appendChild(tr);
  });
}

qs("#refresh-dashboard").addEventListener("click", renderDashboard);

// ============================================================
// BENCHMARKING (vue globale)
// ============================================================

async function renderBenchmarkingTable() {
  const { data, error } = await sb
    .from("competitor_prices")
    .select("*, products(nom)")
    .order("date_releve", { ascending: false });
  if (error) {
    console.error(error);
    return;
  }
  const tbody = qs("#benchmarking-table tbody");
  tbody.innerHTML = "";
  (data || []).forEach((r) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(r.products ? r.products.nom : "—")}</td>
      <td>${escapeHtml(r.concurrent_nom)}</td>
      <td>${fmtMoney(r.prix)}</td>
      <td>${fmtDate(r.date_releve)}</td>
      <td>${r.url_source ? `<a href="${escapeHtml(r.url_source)}" target="_blank" rel="noopener">lien</a>` : "—"}</td>
      <td><button class="icon-btn del-bench" data-id="${r.id}">🗑</button></td>`;
    tbody.appendChild(tr);
  });
  qsa(".del-bench").forEach((b) =>
    b.addEventListener("click", async () => {
      await sb.from("competitor_prices").delete().eq("id", b.dataset.id);
      await renderBenchmarkingTable();
    })
  );
}

// ============================================================
// UTIL
// ============================================================

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
