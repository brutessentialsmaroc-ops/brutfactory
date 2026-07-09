// ============================================================
// Coûts & Rentabilité — logique applicative (v2, mécanisme BRUT FACTORY)
// ============================================================

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function fmtMoney(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + CURRENCY;
}
function fmtPct(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return Number(n).toFixed(1) + " %";
}
function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("fr-FR");
}
function numOrNull(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

// Cache local des référentiels
const cache = { workers: [], chargesFixes: [], devisList: [], parametres: { id: null, ca_mensuel_estime: 0 } };

// ============================================================
// AUTH
// ============================================================

let authMode = "signin";

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
qs("#back-to-devis").addEventListener("click", () => showView("devis"));

async function showView(name) {
  qsa(".view").forEach((v) => v.classList.remove("active"));
  qsa(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  const target = qs("#view-" + name);
  if (target) target.classList.add("active");

  if (name === "dashboard") await renderDashboard();
  if (name === "devis") renderDevisTable();
  if (name === "workers") renderWorkersTable();
  if (name === "charges-fixes") renderChargesFixesTable();
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
// CALCULS (mêmes formules que le fichier Excel)
// ============================================================

// Tarif/jour = (Salaire mensuel x 1,20 CNSS) / Jours par mois
function workerCnss(w) { return Number(w.salaire_mensuel || 0) * 0.2; }
function workerCoutCharge(w) { return Number(w.salaire_mensuel || 0) * 1.2; }
function workerTarifJour(w) {
  const jours = Number(w.jours_mois || 0);
  if (!jours) return 0;
  return workerCoutCharge(w) / jours;
}

function chargesFixesTotalMensuel() {
  return cache.chargesFixes.reduce((sum, c) => sum + Number(c.montant_mensuel || 0), 0);
}

// Calcule tous les indicateurs de rentabilité d'un devis
function calcDevisCosting(devis, materials, labor) {
  const coutMatieres = materials.reduce((sum, m) => sum + Number(m.qte || 0) * Number(m.prix_unitaire || 0), 0);
  const coutMainOeuvre = labor.reduce((sum, l) => {
    const w = cache.workers.find((x) => x.id === l.worker_id);
    return sum + Number(l.nb_jours || 0) * (w ? workerTarifJour(w) : 0);
  }, 0);
  const fraisDivers = Number(devis.frais_livraison || 0) + Number(devis.frais_emballage || 0);
  const coutRevientDirect = coutMatieres + coutMainOeuvre + fraisDivers;

  const prixVenteHT = numOrNull(devis.prix_vente_ht);
  const caMensuel = Number(cache.parametres.ca_mensuel_estime || 0);
  const totalChargesFixes = chargesFixesTotalMensuel();
  const quotePartCharges = prixVenteHT && caMensuel > 0 ? (prixVenteHT / caMensuel) * totalChargesFixes : 0;

  const coutRevientTotal = coutRevientDirect + quotePartCharges;
  const margeBrute = prixVenteHT !== null ? prixVenteHT - coutRevientTotal : null;
  const tauxMarge = prixVenteHT ? (margeBrute / prixVenteHT) * 100 : null;
  const tvaPct = Number(devis.tva_pct || 0);
  const prixTTC = prixVenteHT !== null ? prixVenteHT * (1 + tvaPct / 100) : null;

  return {
    coutMatieres, coutMainOeuvre, fraisDivers, coutRevientDirect,
    prixVenteHT, quotePartCharges, coutRevientTotal, margeBrute, tauxMarge, prixTTC,
  };
}

// ============================================================
// CHARGEMENT DES REFERENTIELS
// ============================================================

async function loadAllReferenceData() {
  const [workers, chargesFixes, devisList, parametres] = await Promise.all([
    sb.from("workers").select("*").order("nom"),
    sb.from("charges_fixes").select("*").order("designation"),
    sb.from("devis").select("*").order("date_devis", { ascending: false }),
    sb.from("parametres").select("*").limit(1),
  ]);
  cache.workers = workers.data || [];
  cache.chargesFixes = chargesFixes.data || [];
  cache.devisList = devisList.data || [];
  cache.parametres = (parametres.data && parametres.data[0]) || { id: null, ca_mensuel_estime: 0 };

  renderWorkersTable();
  renderChargesFixesTable();
  renderDevisTable();
}

// ============================================================
// PRESTATAIRES & TARIFS
// ============================================================

function renderWorkersTable() {
  const tbody = qs("#workers-table tbody");
  tbody.innerHTML = "";
  cache.workers.forEach((w) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(w.nom)}</td>
      <td>${escapeHtml(w.poste || "")}</td>
      <td>${escapeHtml(w.categorie || "")}</td>
      <td>${fmtMoney(w.salaire_mensuel)}</td>
      <td>${fmtMoney(workerCnss(w))}</td>
      <td>${fmtMoney(workerCoutCharge(w))}</td>
      <td>${w.jours_mois}</td>
      <td>${fmtMoney(workerTarifJour(w))}</td>
      <td>
        <button class="icon-btn edit-worker" data-id="${w.id}">✎</button>
        <button class="icon-btn del-worker" data-id="${w.id}">🗑</button>
      </td>`;
    tbody.appendChild(tr);
  });
  qsa(".edit-worker").forEach((b) => b.addEventListener("click", () => editWorker(b.dataset.id)));
  qsa(".del-worker").forEach((b) => b.addEventListener("click", () => deleteWorker(b.dataset.id)));
}

const workerFields = [
  { key: "nom", label: "Nom", type: "text" },
  { key: "poste", label: "Poste (ex: Menuisier, Tapissier)", type: "text" },
  { key: "categorie", label: "Catégorie (ex: Menuiserie bois, Tapisserie)", type: "text" },
  { key: "salaire_mensuel", label: "Salaire mensuel brut (DHS)", type: "number", step: "0.01" },
  { key: "jours_mois", label: "Jours travaillés / mois", type: "number", step: "1" },
  { key: "notes", label: "Notes", type: "textarea" },
];

qs("#add-worker-btn").addEventListener("click", () => {
  openFormModal({
    title: "Nouveau prestataire",
    fields: workerFields,
    initialValues: { jours_mois: 26 },
    onSave: async (values) => {
      const { error } = await sb.from("workers").insert(values);
      if (error) return alert(error.message);
      await loadAllReferenceData();
    },
  });
});

function editWorker(id) {
  const w = cache.workers.find((x) => x.id === id);
  openFormModal({
    title: "Modifier le prestataire",
    fields: workerFields,
    initialValues: w,
    onSave: async (values) => {
      const { error } = await sb.from("workers").update(values).eq("id", id);
      if (error) return alert(error.message);
      await loadAllReferenceData();
    },
  });
}

async function deleteWorker(id) {
  if (!confirm("Supprimer ce prestataire ?")) return;
  const { error } = await sb.from("workers").delete().eq("id", id);
  if (error) return alert(error.message);
  await loadAllReferenceData();
}

// ============================================================
// CHARGES FIXES
// ============================================================

function renderChargesFixesTable() {
  const tbody = qs("#charges-fixes-table tbody");
  tbody.innerHTML = "";
  cache.chargesFixes.forEach((c) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(c.designation)}</td>
      <td>${fmtMoney(c.montant_mensuel)}</td>
      <td>${fmtMoney(Number(c.montant_mensuel || 0) * 12)}</td>
      <td>${escapeHtml(c.notes || "")}</td>
      <td>
        <button class="icon-btn edit-charge-fixe" data-id="${c.id}">✎</button>
        <button class="icon-btn del-charge-fixe" data-id="${c.id}">🗑</button>
      </td>`;
    tbody.appendChild(tr);
  });
  qsa(".edit-charge-fixe").forEach((b) => b.addEventListener("click", () => editChargeFixe(b.dataset.id)));
  qsa(".del-charge-fixe").forEach((b) => b.addEventListener("click", () => deleteChargeFixe(b.dataset.id)));

  const total = chargesFixesTotalMensuel();
  qs("#charges-fixes-total").innerHTML = `<strong>${fmtMoney(total)}</strong>`;
  qs("#charges-fixes-total-annuel").textContent = fmtMoney(total * 12);

  qs("#ca-mensuel-input").value = cache.parametres.ca_mensuel_estime || "";
}

const chargeFixeFields = [
  { key: "designation", label: "Désignation (ex: Loyer atelier)", type: "text" },
  { key: "montant_mensuel", label: "Montant / mois (DHS)", type: "number", step: "0.01" },
  { key: "notes", label: "Notes", type: "textarea" },
];

qs("#add-charge-fixe-btn").addEventListener("click", () => {
  openFormModal({
    title: "Nouvelle charge fixe",
    fields: chargeFixeFields,
    onSave: async (values) => {
      const { error } = await sb.from("charges_fixes").insert(values);
      if (error) return alert(error.message);
      await loadAllReferenceData();
    },
  });
});

function editChargeFixe(id) {
  const c = cache.chargesFixes.find((x) => x.id === id);
  openFormModal({
    title: "Modifier la charge",
    fields: chargeFixeFields,
    initialValues: c,
    onSave: async (values) => {
      const { error } = await sb.from("charges_fixes").update(values).eq("id", id);
      if (error) return alert(error.message);
      await loadAllReferenceData();
    },
  });
}

async function deleteChargeFixe(id) {
  if (!confirm("Supprimer cette charge ?")) return;
  const { error } = await sb.from("charges_fixes").delete().eq("id", id);
  if (error) return alert(error.message);
  await loadAllReferenceData();
}

qs("#save-ca-mensuel").addEventListener("click", async () => {
  const val = Number(qs("#ca-mensuel-input").value || 0);
  if (cache.parametres.id) {
    const { error } = await sb.from("parametres").update({ ca_mensuel_estime: val }).eq("id", cache.parametres.id);
    if (error) return alert(error.message);
  } else {
    const { error } = await sb.from("parametres").insert({ ca_mensuel_estime: val });
    if (error) return alert(error.message);
  }
  await loadAllReferenceData();
});

// ============================================================
// DEVIS (liste)
// ============================================================

function renderDevisTable() {
  const tbody = qs("#devis-table tbody");
  tbody.innerHTML = "";
  cache.devisList.forEach((d) => {
    const tr = document.createElement("tr");
    tr.classList.add("clickable");
    tr.innerHTML = `
      <td>${escapeHtml(d.client || "")}</td>
      <td>${escapeHtml(d.produit_nom)}</td>
      <td>${escapeHtml(d.reference || "")}</td>
      <td>${fmtDate(d.date_devis)}</td>
      <td><button class="icon-btn del-devis" data-id="${d.id}">🗑</button></td>`;
    tr.addEventListener("click", (e) => {
      if (e.target.closest(".del-devis")) return;
      openDevisDetail(d.id);
    });
    tbody.appendChild(tr);
  });
  qsa(".del-devis").forEach((b) =>
    b.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Supprimer ce devis et toutes ses données associées ?")) return;
      const { error } = await sb.from("devis").delete().eq("id", b.dataset.id);
      if (error) return alert(error.message);
      await loadAllReferenceData();
    })
  );
}

qs("#add-devis-btn").addEventListener("click", () => {
  openFormModal({
    title: "Nouveau devis",
    fields: [
      { key: "client", label: "Client", type: "text" },
      { key: "produit_nom", label: "Nom du produit", type: "text" },
      { key: "reference", label: "Référence", type: "text" },
      { key: "date_devis", label: "Date", type: "date" },
    ],
    initialValues: { date_devis: new Date().toISOString().slice(0, 10) },
    onSave: async (values) => {
      if (!values.produit_nom) return alert("Le nom du produit est requis.");
      const { data, error } = await sb.from("devis").insert(values).select().single();
      if (error) return alert(error.message);
      await loadAllReferenceData();
      openDevisDetail(data.id);
    },
  });
});

// ============================================================
// FICHE DEVIS (détail)
// ============================================================

let currentDevisId = null;

async function openDevisDetail(devisId) {
  currentDevisId = devisId;
  showView("devis-detail");
  await refreshDevisDetail();
}

async function refreshDevisDetail() {
  const { data: d, error: dErr } = await sb.from("devis").select("*").eq("id", currentDevisId).single();
  if (dErr || !d) {
    alert("Ce devis est introuvable.");
    showView("devis");
    return;
  }

  qs("#dd-title").textContent = "Fiche devis — " + d.produit_nom;
  qs("#dd-client").value = d.client || "";
  qs("#dd-produit-nom").value = d.produit_nom || "";
  qs("#dd-reference").value = d.reference || "";
  qs("#dd-date").value = d.date_devis || "";
  qs("#dd-longueur").value = d.longueur ?? "";
  qs("#dd-largeur").value = d.largeur ?? "";
  qs("#dd-hauteur").value = d.hauteur ?? "";
  qs("#dd-profondeur").value = d.profondeur ?? "";
  qs("#dd-frais-livraison").value = d.frais_livraison ?? 0;
  qs("#dd-frais-emballage").value = d.frais_emballage ?? 0;
  qs("#dd-prix-vente").value = d.prix_vente_ht ?? "";
  qs("#dd-tva").value = d.tva_pct ?? 20;

  fillSelect(
    "#dd-labor-select",
    cache.workers.map((w) => ({ value: w.id, label: `${w.nom} — ${w.poste || ""} (${fmtMoney(workerTarifJour(w))}/j)` }))
  );

  const [matRes, laborRes, compRes] = await Promise.all([
    sb.from("devis_materials").select("*").eq("devis_id", currentDevisId),
    sb.from("devis_labor").select("*").eq("devis_id", currentDevisId),
    sb.from("competitor_prices").select("*").eq("devis_id", currentDevisId).order("date_releve", { ascending: false }),
  ]);
  const materials = matRes.data || [];
  const labor = laborRes.data || [];

  renderDevisMaterials(materials);
  renderDevisLabor(labor);
  renderDevisCompetitors(compRes.data || []);
  renderDevisCostBreakdown(d, materials, labor);
}

function fillSelect(sel, options) {
  const el = qs(sel);
  el.innerHTML = options.map((o) => `<option value="${o.value}">${escapeHtml(o.label)}</option>`).join("");
}

qs("#dd-save-info").addEventListener("click", async () => {
  const values = {
    client: qs("#dd-client").value,
    produit_nom: qs("#dd-produit-nom").value,
    reference: qs("#dd-reference").value,
    date_devis: qs("#dd-date").value || null,
    longueur: numOrNull(qs("#dd-longueur").value),
    largeur: numOrNull(qs("#dd-largeur").value),
    hauteur: numOrNull(qs("#dd-hauteur").value),
    profondeur: numOrNull(qs("#dd-profondeur").value),
  };
  if (!values.produit_nom) return alert("Le nom du produit est requis.");
  const { error } = await sb.from("devis").update(values).eq("id", currentDevisId);
  if (error) return alert(error.message);
  await loadAllReferenceData();
  await refreshDevisDetail();
});

qs("#dd-delete-devis").addEventListener("click", async () => {
  if (!confirm("Supprimer définitivement ce devis ?")) return;
  const { error } = await sb.from("devis").delete().eq("id", currentDevisId);
  if (error) return alert(error.message);
  await loadAllReferenceData();
  showView("devis");
});

qs("#dd-save-frais").addEventListener("click", async () => {
  const values = {
    frais_livraison: Number(qs("#dd-frais-livraison").value || 0),
    frais_emballage: Number(qs("#dd-frais-emballage").value || 0),
  };
  const { error } = await sb.from("devis").update(values).eq("id", currentDevisId);
  if (error) return alert(error.message);
  await refreshDevisDetail();
});

qs("#dd-save-prix").addEventListener("click", async () => {
  const values = {
    prix_vente_ht: numOrNull(qs("#dd-prix-vente").value),
    tva_pct: Number(qs("#dd-tva").value || 0),
  };
  const { error } = await sb.from("devis").update(values).eq("id", currentDevisId);
  if (error) return alert(error.message);
  await refreshDevisDetail();
});

// ---- Matières premières du devis ----
function renderDevisMaterials(rows) {
  const tbody = qs("#dd-materials-body");
  tbody.innerHTML = "";
  rows.forEach((r) => {
    const total = Number(r.qte || 0) * Number(r.prix_unitaire || 0);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(r.designation)}</td>
      <td>${escapeHtml(r.origine || "")}</td>
      <td>${r.qte}</td>
      <td>${fmtMoney(r.prix_unitaire)}</td>
      <td>${fmtMoney(total)}</td>
      <td><button class="icon-btn del-dm" data-id="${r.id}">🗑</button></td>`;
    tbody.appendChild(tr);
  });
  qsa(".del-dm").forEach((b) =>
    b.addEventListener("click", async () => {
      await sb.from("devis_materials").delete().eq("id", b.dataset.id);
      await refreshDevisDetail();
    })
  );
}

qs("#dd-add-material").addEventListener("click", async () => {
  const designation = qs("#dd-mat-designation").value.trim();
  const origine = qs("#dd-mat-origine").value.trim();
  const qte = Number(qs("#dd-mat-qte").value || 0);
  const prix_unitaire = Number(qs("#dd-mat-prix").value || 0);
  if (!designation || qte <= 0) return alert("Renseigne une désignation et une quantité > 0.");
  const { error } = await sb.from("devis_materials").insert({ devis_id: currentDevisId, designation, origine, qte, prix_unitaire });
  if (error) return alert(error.message);
  qs("#dd-mat-designation").value = "";
  qs("#dd-mat-origine").value = "";
  qs("#dd-mat-qte").value = "";
  qs("#dd-mat-prix").value = "";
  await refreshDevisDetail();
});

// ---- Main d'œuvre du devis ----
function renderDevisLabor(rows) {
  const tbody = qs("#dd-labor-body");
  tbody.innerHTML = "";
  rows.forEach((r) => {
    const w = cache.workers.find((x) => x.id === r.worker_id);
    const tarifJour = w ? workerTarifJour(w) : 0;
    const total = Number(r.nb_jours || 0) * tarifJour;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(w ? w.nom : "?")}</td>
      <td>${escapeHtml(w ? w.categorie || w.poste || "" : "")}</td>
      <td>${r.nb_jours}</td>
      <td>${fmtMoney(tarifJour)}</td>
      <td>${fmtMoney(total)}</td>
      <td><button class="icon-btn del-dl" data-id="${r.id}">🗑</button></td>`;
    tbody.appendChild(tr);
  });
  qsa(".del-dl").forEach((b) =>
    b.addEventListener("click", async () => {
      await sb.from("devis_labor").delete().eq("id", b.dataset.id);
      await refreshDevisDetail();
    })
  );
}

qs("#dd-add-labor").addEventListener("click", async () => {
  const worker_id = qs("#dd-labor-select").value;
  const nb_jours = Number(qs("#dd-labor-jours").value || 0);
  if (!worker_id || nb_jours <= 0) return alert("Choisis un prestataire et un nombre de jours > 0.");
  const { error } = await sb.from("devis_labor").insert({ devis_id: currentDevisId, worker_id, nb_jours });
  if (error) return alert(error.message);
  qs("#dd-labor-jours").value = "";
  await refreshDevisDetail();
});

// ---- Benchmarking concurrents (par devis) ----
function renderDevisCompetitors(rows) {
  const tbody = qs("#dd-competitors-body");
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
      await refreshDevisDetail();
    })
  );
}

qs("#dd-add-competitor").addEventListener("click", async () => {
  const concurrent_nom = qs("#dd-comp-name").value.trim();
  const prix = Number(qs("#dd-comp-price").value || 0);
  const url_source = qs("#dd-comp-url").value.trim();
  if (!concurrent_nom || prix <= 0) return alert("Renseigne le nom du concurrent et un prix > 0.");
  const { error } = await sb
    .from("competitor_prices")
    .insert({ devis_id: currentDevisId, concurrent_nom, prix, url_source: url_source || null });
  if (error) return alert(error.message);
  qs("#dd-comp-name").value = "";
  qs("#dd-comp-price").value = "";
  qs("#dd-comp-url").value = "";
  await refreshDevisDetail();
});

// ---- Récapitulatif & verdict ----
function renderDevisCostBreakdown(devis, materials, labor) {
  const c = calcDevisCosting(devis, materials, labor);

  qs("#dd-cost-breakdown").innerHTML = `
    <div class="row"><span>Coût total matières</span><span>${fmtMoney(c.coutMatieres)}</span></div>
    <div class="row"><span>Coût total main d'œuvre</span><span>${fmtMoney(c.coutMainOeuvre)}</span></div>
    <div class="row"><span>Frais divers</span><span>${fmtMoney(c.fraisDivers)}</span></div>
    <div class="row total"><span>Coût de revient direct</span><span>${fmtMoney(c.coutRevientDirect)}</span></div>
    <div class="row"><span>Quote-part charges fixes</span><span>${fmtMoney(c.quotePartCharges)}</span></div>
    <div class="row total"><span>Coût de revient total</span><span>${fmtMoney(c.coutRevientTotal)}</span></div>
    <div class="row"><span>Marge brute</span><span class="${c.margeBrute !== null && c.margeBrute < 0 ? "negative" : "positive"}">${
    c.margeBrute !== null ? fmtMoney(c.margeBrute) : "—"
  }</span></div>
    <div class="row"><span>Taux de marge réel</span><span class="${c.tauxMarge !== null && c.tauxMarge < 0 ? "negative" : "positive"}">${
    c.tauxMarge !== null ? fmtPct(c.tauxMarge) : "—"
  }</span></div>
    <div class="row"><span>Prix de vente TTC</span><span>${c.prixTTC !== null ? fmtMoney(c.prixTTC) : "—"}</span></div>
  `;

  const verdictEl = qs("#dd-verdict");
  if (c.prixVenteHT === null || c.prixVenteHT === 0) {
    verdictEl.className = "verdict-banner neutral";
    verdictEl.textContent = "⬆️ Saisis ton prix de vente HT pour voir la rentabilité.";
  } else if (c.margeBrute > 0) {
    verdictEl.className = "verdict-banner ok";
    verdictEl.textContent = `✅ RENTABLE — Marge : ${fmtMoney(c.margeBrute)} (${fmtPct(c.tauxMarge)}) — Prix TTC client : ${fmtMoney(c.prixTTC)}`;
  } else {
    verdictEl.className = "verdict-banner bad";
    verdictEl.textContent = `⚠️ PRIX TROP BAS — Tu perds ${fmtMoney(Math.abs(c.margeBrute))} sur ce devis — augmente ton prix !`;
  }
}

// ============================================================
// DASHBOARD
// ============================================================

async function renderDashboard() {
  const [matAllRes, laborAllRes] = await Promise.all([
    sb.from("devis_materials").select("*"),
    sb.from("devis_labor").select("*"),
  ]);
  const matAll = matAllRes.data || [];
  const laborAll = laborAllRes.data || [];

  const rows = cache.devisList.map((d) => {
    const materials = matAll.filter((m) => m.devis_id === d.id);
    const labor = laborAll.filter((l) => l.devis_id === d.id);
    const c = calcDevisCosting(d, materials, labor);
    return { devis: d, costing: c };
  });

  const withPrice = rows.filter((r) => r.costing.prixVenteHT !== null && r.costing.prixVenteHT > 0);
  const rentables = withPrice.filter((r) => r.costing.margeBrute > 0);
  const nonRentables = withPrice.filter((r) => r.costing.margeBrute <= 0);
  const margeMoyenne = withPrice.length
    ? withPrice.reduce((a, r) => a + r.costing.tauxMarge, 0) / withPrice.length
    : null;
  const caPotentiel = withPrice.reduce((a, r) => a + r.costing.prixVenteHT, 0);

  qs("#kpi-row").innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">Devis</div>
      <div class="kpi-value">${cache.devisList.length}</div>
    </div>
    <div class="kpi-card ${margeMoyenne !== null && margeMoyenne < 0 ? "warn" : "good"}">
      <div class="kpi-label">Marge moyenne</div>
      <div class="kpi-value">${margeMoyenne !== null ? fmtPct(margeMoyenne) : "—"}</div>
    </div>
    <div class="kpi-card ${nonRentables.length > 0 ? "warn" : "good"}">
      <div class="kpi-label">Devis non rentables</div>
      <div class="kpi-value">${nonRentables.length}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">CA potentiel (devis chiffrés)</div>
      <div class="kpi-value">${fmtMoney(caPotentiel)}</div>
    </div>
  `;

  const tbody = qs("#dashboard-table tbody");
  tbody.innerHTML = "";
  rows.forEach(({ devis: d, costing: c }) => {
    const tr = document.createElement("tr");
    tr.classList.add("clickable");
    let badge = '<span class="badge neutral">À chiffrer</span>';
    if (c.prixVenteHT !== null && c.prixVenteHT > 0) {
      badge = c.margeBrute > 0 ? '<span class="badge ok">Rentable</span>' : '<span class="badge bad">Perte</span>';
    }
    tr.innerHTML = `
      <td>${escapeHtml(d.client || "")}</td>
      <td>${escapeHtml(d.produit_nom)}</td>
      <td>${fmtDate(d.date_devis)}</td>
      <td>${c.prixVenteHT !== null ? fmtMoney(c.prixVenteHT) : "—"}</td>
      <td>${fmtMoney(c.coutRevientTotal)}</td>
      <td class="${c.margeBrute !== null && c.margeBrute < 0 ? "negative" : "positive"}">${
      c.margeBrute !== null ? fmtMoney(c.margeBrute) : "—"
    }</td>
      <td class="${c.tauxMarge !== null && c.tauxMarge < 0 ? "negative" : "positive"}">${
      c.tauxMarge !== null ? fmtPct(c.tauxMarge) : "—"
    }</td>
      <td>${badge}</td>`;
    tr.addEventListener("click", () => openDevisDetail(d.id));
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
    .select("*, devis(produit_nom, client)")
    .order("date_releve", { ascending: false });
  if (error) {
    console.error(error);
    return;
  }
  const tbody = qs("#benchmarking-table tbody");
  tbody.innerHTML = "";
  (data || []).forEach((r) => {
    const tr = document.createElement("tr");
    const label = r.devis ? `${r.devis.produit_nom}${r.devis.client ? " (" + r.devis.client + ")" : ""}` : "—";
    tr.innerHTML = `
      <td>${escapeHtml(label)}</td>
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
