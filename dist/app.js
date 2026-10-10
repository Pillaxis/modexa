import { createPhotoShare } from "./photo-share.js";
import { createBillingUI } from "./billing-ui.js";
import { categories, matches } from "./catalog.js";
import {
  AUTH_KEY,
  openDB,
  getMeta,
  setMeta,
  removeMeta,
  listModels,
  saveLocalModel,
  changeModel,
  deleteLocalModel,
  getPhoto,
  cachePhoto,
  storedSession,
  purgeOwner,
} from "./local-store.js";
import { makeClient, migrateSession } from "./cloud.js";
import { syncOwner, syncError } from "./sync.js";
import { normalizePhone, authMessage } from "./auth-utils.js";
import {
  createAccountRecovery,
  validatePasswords,
} from "./account-recovery.js";
import { runBackgroundSync, retryDelay } from "./sync-runner.js";
const $ = (s) => document.querySelector(s);
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const paths = {
  home: "M3 10 12 3l9 7v11h-6v-7H9v7H3Z",
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  plus: "M12 5v14 M5 12h14",
  create: "m16 3 5 5-12 12H4v-5Z M14 5l5 5",
  search: "M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  user: "M20 21v-2a7 7 0 0 0-14 0v2 M17 7a5 5 0 1 1-10 0 5 5 0 0 1 10 0",
  heart:
    "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z",
  box: "m12 3 9 5v10l-9 5-9-5V8z M3 8l9 5 9-5 M12 13v10",
  cloud: "M7 18a5 5 0 1 1 0-10 7 7 0 0 1 13 3 3.5 3.5 0 0 1-1 7 M9 16l3 3 4-5",
  back: "M20 12H4 M10 5l-7 7 7 7",
  chevron: "m9 5 7 7-7 7",
  close: "m6 6 12 12 M6 18 18 6",
  check: "m5 12 4 4L20 5",
  camera: "M3 7h4l2-3h6l2 3h4v14H3z M16 14a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  image: "M3 3h18v18H3z m0 14 6-6 6 6 3-3 3 3 M16 7h.01",
  clock: "M12 7v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  spark:
    "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z M20 2v4 M18 4h4",
  crown: "m2 7 5 4 5-8 5 8 5-4-3 13H5z",
  card: "M2 5h20v15H2z M2 10h20",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 2h6l1 3 3 1 3 5-2 3v4l-5 4-3-2-3 2-5-4v-4l-2-3 3-5 3-1z",
  help: "M9 8a3 3 0 0 1 6 0c0 3-3 2-3 5 M12 17h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  logout: "M9 3H3v18h6 M8 12h14 m-6-6 6 6-6 6",
  share:
    "M15 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M8 10l5-4 M8 14l7 4",
};
const icon = (name, cls = "") =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.grid}"/></svg>`;
const state = {
  page: "home",
  models: [],
  user: null,
  loading: false,
  query: "",
  category: "",
  subcategory: "",
  favorites: false,
  selecting: false,
  selected: new Set(),
  files: [],
  draft: { reference: "", category: "", subcategory: "" },
  authMethod: "phone",
  signup: false,
  subscription: null,
};
let client = null,
  toastTimer,
  previousPage = "home",
  dataEpoch = 0,
  authRevision = 0;
const accountGuard = () => {
  const owner = state.user?.id,
    epoch = dataEpoch;
  return () =>
    Boolean(owner) && state.user?.id === owner && dataEpoch === epoch;
};
let syncRun = null,
  swRegistration = null,
  localRefreshTimer,
  draftTimer,
  draftWrite = Promise.resolve(),
  saveBusy = false,
  draftVersion = 0;
let syncRetryTimer;
const imageURLs = new Map();
let authBusy = false;
const authDraft = { phone: "", prefix: "+228", email: "" };
const billing = createBillingUI({
  state,
  getClient: () => client,
  modal,
  toast,
  render: () => safeRender(),
  requestSync: (pull) => requestSync(pull),
  navigate,
  doc: document,
});
const recovery = createAccountRecovery({
  doc: document,
  getClient: () => client,
  onStart: () => clearUser(),
  onComplete: async (user) => {
    await acceptUser(user);
    toast("Votre nouveau mot de passe est enregistré.");
  },
  onCancel: () => {
    clearUser();
    state.signup = false;
    auth();
  },
});
state.billingKnown = false;
state.usage = null;
state.booting = true;
state.visibleCount = 60;
state.syncing = false;
state.authReady = false;
state.syncMessage = "";
const photo = (m, cls = "") =>
  m.images?.[0]?.url
    ? `<div class="${cls}"><img src="${esc(m.images[0].url)}" alt="${esc(m.name)}" loading="lazy"></div>`
    : `<div class="photo-empty ${cls}">${icon("image")}<span>${m.images?.length ? (navigator.onLine ? "Chargement de la photo…" : "Photo disponible en ligne") : "Sans photo"}</span></div>`;
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 4500);
}
function navigate(page) {
  if (!state.user) {
    render();
    return;
  }
  if (page === "add" && !billing.canAdd()) {
    billing.show(true);
    return;
  }
  if (state.page === "profile") {
  } else previousPage = state.page;
  state.page = page;
  state.visibleCount = 60;
  state.selected.clear();
  state.selecting = false;
  render();
  window.scrollTo(0, 0);
}
function header() {
  const title = {
    home: "MODEXA",
    categories: "Catégories",
    subcategories: state.category,
    add: "Ajouter",
    create: "Créer",
    profile: "Profil",
    gallery: "Mon catalogue",
  }[state.page];
  return `<header><div class="row">${state.page === "profile" ? `<button class="icon-button" data-action="back" aria-label="Retour à l’application">${icon("back")}</button>` : ""}<div class="wordmark">${esc(title)}${state.page === "home" ? "<span>.</span>" : ""}</div></div>${state.page !== "profile" ? `<div class="header-right"><span class="header-label">Votre espace boutique</span><button class="icon-button" data-action="search" aria-label="Recherche">${icon("search")}</button><button class="icon-button avatar" data-page="profile" aria-label="Profil">${icon("user")}</button></div>` : ""}</header>`;
}
function nav() {
  return state.page === "profile"
    ? ""
    : `<nav class="bottom-nav" aria-label="Navigation principale">${[
        ["home", "home", "Accueil"],
        ["categories", "grid", "Catégories"],
        ["add", "plus", "Ajouter"],
        ["create", "create", "Créer"],
      ]
        .map(
          ([p, i, l]) =>
            `<button class="nav-item ${state.page === p || (p === "categories" && (state.page === "subcategories" || (state.page === "gallery" && state.category))) ? "active" : ""}" ${state.page === p ? 'aria-current="page"' : ""} data-page="${p}">${icon(i)}<span>${l}</span></button>`,
        )
        .join("")}</nav>`;
}
function sessionNote() {
  return !state.user
    ? `<div class="session-bar"><span>Connectez-vous pour créer votre catalogue</span><button data-action="auth">Se connecter</button></div>`
    : "";
}
function cards(models) {
  if (!models.length)
    return `<div class="empty">${icon("image")}<h2>Aucun modèle pour le moment</h2><p>Ajoutez vos photos ou essayez une autre recherche.</p><button class="primary" data-page="add">${icon("plus")} Ajouter un modèle</button></div>`;
  return `<div class="products">${models.map((m) => `<article class="product ${state.selected.has(m.id) ? "selected" : ""}">${state.selecting ? `<button class="select-check" data-select="${esc(m.id)}" aria-label="Sélectionner ${esc(m.name)}" aria-pressed="${state.selected.has(m.id)}">${state.selected.has(m.id) ? icon("check") : ""}</button>` : ""}<button class="product-image" data-model="${esc(m.id)}" aria-label="Ouvrir ${esc(m.name)}, référence ${esc(m.reference)}">${photo(m, "product-image")}${m.reference ? `<span class="ref-tag">${esc(m.reference)}</span>` : ""}</button><div class="product-info"><div><h3>${esc(m.name)}</h3><p>${esc(m.subcategory || m.category || "Non classé")}</p></div><button class="heart ${m.favorite ? "active" : ""}" data-favorite="${esc(m.id)}" aria-label="Favori : ${esc(m.name)}" aria-pressed="${!!m.favorite}">${icon("heart")}</button></div></article>`).join("")}</div>`;
}
function home() {
  const count = state.models.length,
    month = new Date().toISOString().slice(0, 7),
    added = state.models.filter((m) => m.created_at?.startsWith(month)).length;
  return `<main class="page"><div class="intro"><div><div class="eyebrow">Ma collection, en un clin d’œil</div><h1>Votre catalogue. Partout avec vous.</h1><p class="muted">Tous vos modèles, toujours à portée de main.</p></div><button class="primary" data-page="add">${icon("plus")}<span>Ajouter un modèle</span></button></div><section class="stats" aria-label="Mon activité">${[
    ["box", count, "Modèles enregistrés"],
    ["plus", added, "Ajoutés ce mois-ci"],
    [
      "grid",
      new Set(state.models.map((m) => m.category).filter(Boolean)).size,
      "Catégories utilisées",
    ],
  ]
    .map(
      ([i, n, l]) =>
        `<div class="stat"><div class="stat-icon">${icon(i)}</div><div><strong>${n.toString().padStart(2, "0")}</strong><p>${l}</p></div></div>`,
    )
    .join(
      "",
    )}</section><div class="section-heading"><h2>Ajoutés récemment</h2><button class="text-button" data-action="all">Voir tout ${icon("grid")}</button></div>${cards(state.models.slice(0, 4))}<div class="section-heading"><h2>Mes catégories</h2><button class="text-button" data-page="categories">Tout voir ${icon("grid")}</button></div><div class="category-grid">${categories.map((c, i) => `<button class="category-tile" data-category="${esc(c.name)}"><div class="category-art" aria-hidden="true">${icon("grid")}</div><div class="category-caption"><span>${c.name}</span><span class="count">${state.models.filter((m) => m.category === c.name).length}</span></div></button>`).join("")}</div>${sessionNote()}<div class="quiet-footer">${icon(state.user ? "cloud" : "box")}${state.user ? "Votre collection est disponible sur cet appareil." : "Ajouter. Classer. Retrouver. Partager."}</div></main>`;
}
function render() {
  if (recovery.active) {
    recovery.render();
    return;
  }
  if (!state.user) {
    if (state.booting) {
      $("#app").innerHTML = bootScreen();
      return;
    }
    if (!$("#app #auth-form")) renderAuthGate();
    return;
  }
  const focus = document.activeElement?.id,
    selection =
      focus === "search" ? document.activeElement.selectionStart : null;
  $("#app").innerHTML =
    header() +
    (state.loadError && state.user
      ? `<div class="session-bar" role="alert" style="max-width:1140px;margin:16px auto"><span>${esc(state.loadError)}</span><button data-action="refresh">Réessayer</button></div>`
      : "") +
    (state.page === "home" ? home() : renderPage()) +
    nav();
  const add = $(".intro>.primary");
  if (add) add.setAttribute("aria-label", "Ajouter un modèle");
  if (state.loadError && state.user && $(".quiet-footer"))
    $(".quiet-footer").textContent =
      "Votre collection reste disponible sur cet appareil.";
  if (focus === "search" && $("#search")) {
    $("#search").focus();
    try {
      $("#search").setSelectionRange(selection, selection);
    } catch {}
  }
  queueMicrotask(() => hydratePhotos().catch(() => {}));
}
function renderPage() {
  return (
    {
      categories: categoryPage,
      subcategories: subcategoryPage,
      gallery: gallery,
      add: addPage,
      create: createPage,
      profile: profilePage,
    }[state.page] || home
  )();
}
function categoryPage() {
  return `<main class="page"><div class="intro"><div><div class="eyebrow">Une place pour chaque modèle</div><h1>Explorez vos catégories</h1></div></div><div class="category-list">${categories.map((c, i) => `<button class="category-row category-link" data-category="${esc(c.name)}"><div class="category-cover category-art" aria-hidden="true">${icon("grid")}</div><div class="category-body"><h2>${c.name}</h2><p class="muted">${state.models.filter((m) => m.category === c.name).length} modèles</p></div>${icon("chevron")}</button>`).join("")}</div>${sessionNote()}</main>`;
}
function subcategoryPage() {
  const c = categories.find((c) => c.name === state.category);
  if (!c) return categoryPage();
  return `<main class="page"><button class="text-button back-link" data-page="categories">${icon("back")} Toutes les catégories</button><div class="intro"><div><div class="eyebrow">Choisissez une sous-catégorie</div><h1>${esc(c.name)}</h1></div></div><div class="subcategory-list"><button class="subcategory-link" data-action="category-models"><span>Tous les modèles</span><span class="count">${state.models.filter((m) => m.category === c.name).length}</span>${icon("chevron")}</button>${c.sub.map((s) => `<button class="subcategory-link" data-subcategory="${esc(s)}" data-parent="${esc(c.name)}"><span>${esc(s)}</span><span class="count">${state.models.filter((m) => m.category === c.name && m.subcategory === s).length}</span>${icon("chevron")}</button>`).join("")}</div>${sessionNote()}</main>`;
}
function filtered() {
  return state.models.filter(
    (m) =>
      (!state.category || m.category === state.category) &&
      (!state.subcategory || m.subcategory === state.subcategory) &&
      (!state.favorites || m.favorite) &&
      matches(m, state.query),
  );
}
function results() {
  const models = filtered();
  return `<div class="section-heading"><p class="muted">${models.length} modèle${models.length !== 1 ? "s" : ""}</p><button class="text-button" data-action="select">${state.selecting ? "Terminer la sélection" : "Sélectionner"}</button></div>${state.selecting ? `<div class="selection-bar"><span>${state.selected.size} sélectionné${state.selected.size > 1 ? "s" : ""}</span><button class="text-button" data-action="select-all">Tout sélectionner</button><button class="primary" data-action="share" ${!state.selected.size ? "disabled" : ""}>${icon("share")} Choisir les photos</button></div>` : ""}${cards(models.slice(0, state.visibleCount))}${models.length > state.visibleCount ? '<button class="secondary load-more" data-action="more">Afficher plus de modèles</button>' : ""}`;
}
function gallery() {
  return `<main class="page">${state.category ? `<button class="text-button back-link" data-page="subcategories">${icon("back")} ${esc(state.category)}</button>` : ""}<div class="gallery-header"><div class="eyebrow">Retrouvez le bon modèle</div><h1>${esc(state.subcategory || state.category || "Mon catalogue")}</h1></div><div class="search-field">${icon("search")}<input id="search" type="search" placeholder="Nom, catégorie ou référence…" aria-label="Rechercher par nom, catégorie ou référence" value="${esc(state.query)}"></div><div class="toolbar"><button class="pill ${!state.favorites ? "active" : ""}" data-action="show-all">Tous les modèles</button><button class="pill ${state.favorites ? "active" : ""}" data-action="favorites">${icon("heart")} Favoris</button>${state.category ? '<button class="pill" data-action="clear-category">Toutes les catégories</button>' : ""}</div><div id="results" aria-live="polite">${results()}</div>${sessionNote()}</main>`;
}
function uploads() {
  return (
    state.files
      .map(
        (f, i) =>
          `<div class="upload-preview"><img src="${f.preview}" alt="Photo ${i + 1}"><button class="remove-photo" type="button" data-remove="${i}" aria-label="Retirer la photo ${i + 1}">${icon("close")}</button></div>`,
      )
      .join("") +
    (state.files.length < 10
      ? `<button type="button" class="upload-tile" data-action="pick">${icon("plus")}Ajouter une photo</button>`
      : "")
  );
}
function addPage() {
  const d = state.draft;
  return `<main class="page form-page"><div class="intro"><div><div class="eyebrow">Enrichissez votre collection</div><h1>Un nouveau modèle</h1></div></div><form id="add-form" class="form-section"><div class="section-heading" style="margin:0"><h2>Photos du modèle <span class="req" aria-hidden="true">*</span></h2><span class="badge" id="photo-count">${state.files.length}/10 photos</span></div><p class="hint">Ajoutez au moins une photo (10 maximum).</p><div class="upload-grid" id="uploads">${uploads()}</div><input id="file-input" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden><input id="camera-input" type="file" accept="image/*" capture="environment" hidden><div class="row"><button type="button" class="secondary" data-action="camera">${icon("camera")}Prendre une photo</button><button type="button" class="secondary" data-action="pick">${icon("image")}Choisir dans la galerie</button></div><div class="form-grid"><label class="full">Catégorie <span class="req" aria-hidden="true">*</span><select name="category" required><option value="">Choisir une catégorie</option>${categories.map((c) => `<option value="${esc(c.name)}" ${c.name === d.category ? "selected" : ""}>${c.name}</option>`).join("")}</select></label><label class="full">Sous-catégorie <span class="req" aria-hidden="true">*</span><select name="subcategory" ${!d.category ? "disabled" : ""} required>${subcategoryOptions(d.category, d.subcategory)}</select></label><label class="full">Référence <span class="opt">(facultatif)</span><input name="reference" maxlength="40" placeholder="Ex. : R9538 (facultatif)" value="${esc(d.reference)}"><p class="hint">Facultative — si vous en ajoutez une, elle sera visible avec le modèle.</p></label></div><p id="save-error" class="inline-error" role="alert"></p><div class="form-actions"><button type="button" class="secondary" data-page="home">Annuler</button><button class="primary" id="save-button" type="submit">${icon("check")}Enregistrer</button></div>${!state.user ? '<p class="hint">Connectez-vous pour enregistrer vos modèles dans votre espace personnel.</p>' : ""}</form></main>`;
}
function subcategoryOptions(category, selected = "") {
  return (
    '<option value="">Choisir une sous-catégorie</option>' +
    (categories.find((c) => c.name === category)?.sub || [])
      .map(
        (s) =>
          `<option value="${esc(s)}" ${s === selected ? "selected" : ""}>${s}</option>`,
      )
      .join("")
  );
}
function createPage() {
  return `<main class="page create-page"><div class="create-symbol">${icon("spark")}</div><div class="badge">${icon("clock")}En préparation</div><h1>Création IA<br>Bientôt disponible</h1><p class="muted">Prochainement, vous pourrez créer vos propres images professionnelles directement dans MODEXA.</p></main>`;
}
function profilePage() {
  const name = state.user?.user_metadata?.full_name || "Votre boutique",
    contact = state.user?.phone
      ? `+${state.user.phone.replace(/^\+/, "")}`
      : state.user?.email || "Connectez-vous à votre espace personnel";
  const offer = billing.current();
  return `<main class="page profile-page"><div class="profile-identity"><div class="profile-avatar">${icon("user")}</div><div><h1>${esc(name)}</h1><p class="muted">${esc(contact)}</p></div></div><div class="plan-card">${icon("crown")}<div><h2>MODEXA ${offer.name}</h2><p>${billing.status()}</p></div><button class="badge" data-action="subscription">${offer.plan === "free" ? "Voir les offres" : "Gérer mon offre"}</button></div><div class="profile-links">${[
    [
      "personal",
      "user",
      "Informations personnelles",
      "Gérez vos informations de compte",
    ],
    [
      "subscription",
      "card",
      "Mon abonnement",
      "Voir et gérer votre abonnement",
    ],
    ["settings", "settings", "Paramètres", "Préférences de l’application"],
    ["help", "help", "Aide", "Bien démarrer avec MODEXA"],
    [
      state.user ? "logout" : "auth",
      "logout",
      state.user ? "Déconnexion" : "Connexion",
      "Retrouvez votre catalogue sur tous vos appareils",
    ],
  ]
    .map(
      ([a, i, t, d]) =>
        `<button class="profile-link" data-action="${a}">${icon(i)}<div><strong>${t}</strong><p>${d}</p></div>${icon("chevron", "chevron")}</button>`,
    )
    .join("")}</div></main>`;
}
function modal(title, body) {
  const el = $("#modal");
  el.classList.remove("model-detail", "billing-modal");
  el.innerHTML = `<div class="modal-heading"><h2>${esc(title)}</h2><button data-action="close" aria-label="Fermer">${icon("close")}</button></div>${body}`;
  if (!el.open) el.showModal();
}
function bootScreen() {
  return '<main class="boot-screen" aria-label="Ouverture de MODEXA"><div class="wordmark">MODEXA<span>.</span></div></main>';
}
function authContent() {
  return `<p class="auth-intro muted">Retrouvez vos modèles sur tous vos appareils.</p><div class="auth-tabs"><button class="${state.authMethod === "phone" ? "active" : ""}" data-auth="phone">Téléphone</button><button class="${state.authMethod === "email" ? "active" : ""}" data-auth="email">E-mail</button></div><form id="auth-form" class="dialog-form">${state.authMethod === "phone" ? `<label>Numéro de téléphone<div class="phone-input"><select name="prefix" aria-label="Indicatif">${["+228", "+229", "+225", "+233", "+221", "+226", "+33"].map((p) => `<option ${authDraft.prefix === p ? "selected" : ""}>${p}</option>`).join("")}</select><input name="phone" aria-label="Numéro de téléphone" type="tel" autocomplete="tel-national" placeholder="90 12 34 56" value="${esc(authDraft.phone)}" required></div></label>` : `<label>Adresse e-mail<input name="email" type="email" autocomplete="email" autocapitalize="none" spellcheck="false" placeholder="vous@exemple.com" value="${esc(authDraft.email)}" required></label>`}<label>Mot de passe<div class="password-field"><input name="password" type="password" autocomplete="${state.signup ? "new-password" : "current-password"}" ${state.signup ? 'minlength="8"' : ""} required placeholder="${state.signup ? "8 caractères minimum" : "Votre mot de passe"}"><button type="button" data-action="show-password" aria-label="Afficher le mot de passe">Afficher</button></div></label>${state.signup ? `<label>Confirmer le mot de passe<div class="password-field"><input name="password_confirmation" type="password" autocomplete="new-password" minlength="8" required placeholder="Saisissez le même mot de passe"><button type="button" data-action="show-password" aria-label="Afficher la confirmation du mot de passe">Afficher</button></div></label>` : ""}<p class="hint">${state.signup ? "Inscription directe, sans code de confirmation." : "Utilisez le même e-mail ou numéro que lors de votre inscription."}</p><p id="auth-error" class="inline-error" role="alert"></p><button class="primary" type="submit">${state.signup ? "Créer mon compte" : "Se connecter"}</button></form>${!state.signup ? `<button class="text-button" type="button" data-action="forgot-password">Mot de passe oublié ?</button>` : ""}<p class="auth-footer">${state.signup ? "Déjà inscrit ?" : "Pas encore de compte ?"} <button data-action="toggle-signup">${state.signup ? "Se connecter" : "Créer un compte"}</button></p>`;
}
function renderAuthGate() {
  $("#modal").close();
  $("#app").innerHTML =
    `<main class="auth-page"><div class="auth-brand wordmark">MODEXA<span>.</span></div><section class="auth-card" aria-labelledby="auth-title"><div class="eyebrow">Votre boutique, partout avec vous</div><h1 id="auth-title">${state.signup ? "Créer un compte" : "Bienvenue chez vous"}</h1>${authContent()}</section><p class="auth-reassurance">Ajouter. Classer. Retrouver. Partager.</p></main>`;
  if (state.initError) $("#auth-error").textContent = state.initError;
}
function auth() {
  const current = $("#auth-form");
  if (current) {
    for (const name of ["phone", "prefix", "email"])
      if (current.elements[name])
        authDraft[name] = current.elements[name].value;
  }
  if (!state.user) {
    state.booting = false;
    renderAuthGate();
  } else
    modal(state.signup ? "Créer un compte" : "Se connecter", authContent());
}
function displayError(error) {
  if (error?.code === "PGRST205")
    return "Votre espace cloud est en cours de préparation. Réessayez après sa configuration.";
  if (error?.code === "23505")
    return "Cette référence existe déjà dans votre catalogue.";
  if (
    /provider.*disabled|phone.*disabled|Unsupported phone/i.test(
      error?.message || "",
    )
  )
    return "La connexion par téléphone doit encore être activée. Vous pouvez utiliser l’e-mail.";
  if (/Invalid login/i.test(error?.message || ""))
    return "Numéro, e-mail ou mot de passe incorrect.";
  if (/not confirmed/i.test(error?.message || ""))
    return "Veuillez confirmer votre compte avant de vous connecter.";
  if (/rate limit/i.test(error?.message || ""))
    return "Trop de tentatives. Veuillez patienter quelques minutes.";
  return error?.message || "Une erreur est survenue. Veuillez réessayer.";
}
async function submitAuth(form) {
  if (authBusy) return;
  const errorEl = $("#auth-error"),
    button = form.querySelector("[type=submit]");
  errorEl.textContent = "";
  if (!client) {
    errorEl.textContent =
      state.initError || "MODEXA démarre. Réessayez dans un instant.";
    return;
  }
  if (!navigator.onLine) {
    errorEl.textContent =
      "Une connexion internet est nécessaire pour ouvrir votre compte.";
    return;
  }
  const f = new FormData(form),
    label = button.textContent;
  let slowTimer;
  try {
    const credentials = { password: String(f.get("password")) };
    if (state.authMethod === "phone") {
      credentials.phone = normalizePhone(f.get("phone"), f.get("prefix"));
      authDraft.phone = String(f.get("phone"));
      authDraft.prefix = String(f.get("prefix"));
    } else {
      credentials.email = String(f.get("email")).trim().toLowerCase();
      authDraft.email = credentials.email;
    }
    if (state.signup)
      validatePasswords(
        credentials.password,
        String(f.get("password_confirmation") || ""),
      );
    authBusy = true;
    form.setAttribute("aria-busy", "true");
    button.disabled = true;
    button.textContent = state.signup ? "Création du compte…" : "Connexion…";
    // A slow network must never look like an unresponsive button or a successful login.
    slowTimer = setTimeout(() => {
      if (form.isConnected)
        errorEl.textContent =
          "La connexion prend plus de temps. Vous pouvez patienter ou réessayer lorsque le réseau est meilleur.";
    }, 2500);
    const { data, error } = state.signup
      ? await client.auth.signUp(credentials)
      : await client.auth.signInWithPassword(credentials);
    if (error) throw error;
    if (!data.session)
      throw Error(
        "Votre compte n’a pas pu être ouvert immédiatement. Réessayez avec « Se connecter ».",
      );
    $("#modal").close();
    await acceptUser(data.user);
    toast("Bienvenue dans votre boutique.");
  } catch (error) {
    errorEl.textContent = authMessage(error);
  } finally {
    clearTimeout(slowTimer);
    authBusy = false;
    form.removeAttribute("aria-busy");
    button.disabled = false;
    button.textContent = label;
  }
}
async function refresh() {
  if (!client || !state.user) return;
  await loadLocal();
  requestSync(true);
}
async function favorite(id) {
  const active = accountGuard();
  const m = state.models.find((x) => x.id === id);
  if (!m) return;
  if (!state.user) {
    auth();
    return;
  }
  const saved = await changeModel(state.user.id, id, { favorite: !m.favorite });
  if (!active()) return;
  Object.assign(m, saved, { images: m.images });
  render();
  requestSync();
}
async function addFiles(files) {
  for (const file of files) {
    if (state.files.length >= 10) {
      toast("Vous pouvez ajouter jusqu’à 10 photos par modèle.");
      break;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast("Choisissez une image JPG, PNG ou WebP.");
      continue;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast("Chaque photo doit peser moins de 10 Mo.");
      continue;
    }
    state.files.push({ file, preview: URL.createObjectURL(file) });
  }
  $("#uploads").innerHTML = uploads();
  $("#photo-count").textContent = `${state.files.length}/10 photos`;
  if ($("#save-error")) $("#save-error").textContent = "";
  scheduleDraft();
}
function validateModelForm(category, subcategory, count, errorEl) {
  const group = categories.find((c) => c.name === category);
  const message =
    count < 1
      ? "Ajoutez au moins une photo."
      : count > 10
        ? "Vous pouvez ajouter jusqu’à 10 photos."
        : !group
          ? "Choisissez une catégorie."
          : !group.sub.includes(subcategory)
            ? "Choisissez une sous-catégorie."
            : "";
  if (errorEl) errorEl.textContent = message;
  return !message;
}
async function saveModel(form) {
  if (saveBusy) return;
  const errorEl = $("#save-error");
  if (errorEl) errorEl.textContent = "";
  const f = new FormData(form);
  const category = String(f.get("category") || "").trim();
  const subcategory = String(f.get("subcategory") || "").trim();
  if (!validateModelForm(category, subcategory, state.files.length, errorEl))
    return;
  if (!state.user) {
    if (errorEl)
      errorEl.textContent =
        "Connectez-vous pour enregistrer votre modèle dans votre espace boutique.";
    auth();
    return;
  }
  const reference = String(f.get("reference") || "").trim() || null;
  const button = $("#save-button");
  saveBusy = true;
  button.disabled = true;
  button.textContent = "Enregistrement…";
  const owner = state.user.id,
    active = accountGuard(),
    files = [...state.files];
  try {
    if (!(await billing.ensureCanAdd()) || !active()) return;
    clearTimeout(draftTimer);
    draftVersion++;
    await draftWrite;
    if (!active()) return;
    const id = crypto.randomUUID();
    const photos = files.map(({ file }, n) => ({
      path: owner + "/" + id + "/" + n + "." + file.type.split("/")[1],
      blob: file,
    }));
    const record = {
      id,
      user_id: owner,
      name: subcategory || category || "Modèle sans catégorie",
      reference,
      category: category || null,
      subcategory: subcategory || null,
      favorite: false,
      images: photos.map((p) => ({ path: p.path })),
      created_at: new Date().toISOString(),
    };
    const saved = await saveLocalModel(record, photos, {
      limit: billing.current().limit,
      knownUsed: state.usage?.used || 0,
      pendingDeletes: state.pendingDeletes || 0,
      quota: state.usage?.quota,
    });
    if (!active()) return;
    files.forEach((p, n) => {
      imageURLs.set(photos[n].path, p.preview);
    });
    state.models.unshift({
      ...saved,
      images: saved.images.map((i) => ({ ...i, url: imageURLs.get(i.path) })),
    });
    state.files = [];
    state.draft = { reference: "", category: "", subcategory: "" };
    navigate("home");
    toast("Modèle enregistré.");
    navigator.storage?.persist?.().catch(() => {});
    requestSync();
  } catch (error) {
    if (!active()) return;
    if (error?.code === "MODEXA_QUOTA_REACHED") {
      billing.show(true);
      return;
    }
    if ($("#save-error"))
      $("#save-error").textContent =
        error?.name === "QuotaExceededError"
          ? "Stockage de cet appareil plein. Libérez de la place puis réessayez. Vos photos restent dans le formulaire."
          : displayError(error);
  } finally {
    if (active()) {
      saveBusy = false;
      if ($("#save-button")) {
        $("#save-button").disabled = false;
        $("#save-button").innerHTML = icon("check") + "Enregistrer";
      }
    }
  }
}
let editDraft = null,
  editBusy = false;
function editModelModal(id) {
  const m = state.models.find((x) => x.id === id);
  if (!m || !state.user) return;
  editDraft = {
    id: m.id,
    category: m.category || "",
    subcategory: m.subcategory || "",
    reference: m.reference || "",
    images: [...m.images],
    newFiles: [],
  };
  renderEditModal();
}
function renderEditModal() {
  if (!editDraft) return;
  const totalCount = editDraft.images.length + editDraft.newFiles.length;
  modal(
    "Modifier le modèle",
    `<form id="edit-form" class="dialog-form" style="gap:16px"><div class="section-heading" style="margin:0"><h2>Photos du modèle <span class="req" aria-hidden="true">*</span></h2><span class="badge" id="edit-photo-count">${totalCount}/10 photos</span></div><p class="hint">Conservez au moins une photo (10 maximum).</p><div class="upload-grid" id="edit-uploads">${editDraft.images.map((img, i) => `<div class="upload-preview"><img src="${esc(img.url || "")}" alt="Photo ${i + 1}">${totalCount > 0 ? `<button class="remove-photo" type="button" data-edit-remove-old="${i}" aria-label="Retirer photo ${i + 1}">${icon("close")}</button>` : ""}</div>`).join("")}${editDraft.newFiles.map((f, i) => `<div class="upload-preview"><img src="${f.preview}" alt="Nouvelle photo ${i + 1}">${totalCount > 0 ? `<button class="remove-photo" type="button" data-edit-remove-new="${i}" aria-label="Retirer nouvelle photo ${i + 1}">${icon("close")}</button>` : ""}</div>`).join("")}${totalCount < 10 ? `<button type="button" class="upload-tile" data-action="edit-pick">${icon("plus")}Ajouter</button>` : ""}</div><input id="edit-file-input" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden><input id="edit-camera-input" type="file" accept="image/*" capture="environment" hidden><div class="row"><button type="button" class="secondary" data-action="edit-camera">${icon("camera")}Prendre photo</button><button type="button" class="secondary" data-action="edit-pick">${icon("image")}Choisir galerie</button></div><label>Catégorie <span class="req" aria-hidden="true">*</span><select name="category" id="edit-category" required><option value="">Choisir une catégorie</option>${categories.map((c) => `<option value="${esc(c.name)}" ${c.name === editDraft.category ? "selected" : ""}>${c.name}</option>`).join("")}</select></label><label>Sous-catégorie <span class="req" aria-hidden="true">*</span><select name="subcategory" id="edit-subcategory" ${!editDraft.category ? "disabled" : ""} required>${subcategoryOptions(editDraft.category, editDraft.subcategory)}</select></label><label>Référence <span class="opt">(facultatif)</span><input name="reference" id="edit-reference" maxlength="40" placeholder="Ex. : R9538 (facultatif)" value="${esc(editDraft.reference)}"><p class="hint">Facultative — visible avec le modèle.</p></label><p id="edit-error" class="inline-error" role="alert"></p><div class="form-actions"><button type="button" class="secondary" data-action="close">Annuler</button><button class="primary" type="submit" id="edit-save-btn">${icon("check")}Enregistrer</button></div></form>`,
  );
}
async function addEditFiles(files) {
  if (!editDraft) return;
  for (const file of files) {
    if (editDraft.images.length + editDraft.newFiles.length >= 10) {
      toast("Vous pouvez ajouter jusqu’à 10 photos par modèle.");
      break;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast("Choisissez une image JPG, PNG ou WebP.");
      continue;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast("Chaque photo doit peser moins de 10 Mo.");
      continue;
    }
    editDraft.newFiles.push({ file, preview: URL.createObjectURL(file) });
  }
  renderEditModal();
}
async function saveEditedModel(form) {
  if (!editDraft || !state.user || editBusy) return;
  const errorEl = $("#edit-error");
  if (errorEl) errorEl.textContent = "";
  const totalCount = editDraft.images.length + editDraft.newFiles.length;
  const f = new FormData(form);
  const category = String(f.get("category") || "").trim();
  const subcategory = String(f.get("subcategory") || "").trim();
  if (!validateModelForm(category, subcategory, totalCount, errorEl)) return;
  const reference = String(f.get("reference") || "").trim() || null;
  editBusy = true;
  const btn = $("#edit-save-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Enregistrement…";
  }
  const owner = state.user.id,
    id = editDraft.id,
    active = accountGuard(),
    draft = editDraft;
  try {
    const newPhotos = draft.newFiles.map(({ file }, n) => {
      const ext = file.type.split("/")[1] || "jpg",
        path = `${owner}/${id}/edit_${crypto.randomUUID()}_${n}.${ext}`;
      return { path, blob: file };
    });
    if (!active()) return;
    draft.newFiles.forEach((p, n) => {
      imageURLs.set(newPhotos[n].path, p.preview);
    });
    const finalImages = [
      ...draft.images.map((img) => ({
        path: img.path,
        url: img.url || imageURLs.get(img.path),
      })),
      ...newPhotos.map((p) => ({ path: p.path, url: imageURLs.get(p.path) })),
    ];
    const changes = {
      name: subcategory || category || "Modèle sans catégorie",
      category: category || null,
      subcategory: subcategory || null,
      reference,
      images: finalImages.map(({ path }) => ({ path })),
    };
    const previousImages = state.models.find((m) => m.id === id)?.images || [];
    const saved = await changeModel(owner, id, changes, { photos: newPhotos });
    if (!active()) return;
    for (const old of previousImages) {
      if (!finalImages.some((i) => i.path === old.path)) {
        const url = imageURLs.get(old.path);
        if (url) URL.revokeObjectURL(url);
        imageURLs.delete(old.path);
      }
    }
    const idx = state.models.findIndex((x) => x.id === id);
    if (idx !== -1) state.models[idx] = { ...saved, images: finalImages };
    $("#modal").close();
    editDraft = null;
    render();
    toast("Modèle mis à jour avec succès.");
    requestSync();
  } catch (err) {
    if (!active()) return;
    if (errorEl) errorEl.textContent = displayError(err);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = icon("check") + "Enregistrer";
    }
  } finally {
    if (active()) editBusy = false;
  }
}
async function deleteModel(id) {
  const m = state.models.find((x) => x.id === id);
  if (!m || !state.user) return;
  const owner = state.user.id,
    active = accountGuard();
  try {
    await deleteLocalModel(owner, id);
    const deleted = await getMeta(`deleted:${owner}`);
    if (!active()) return;
    state.pendingDeletes = (deleted || []).length;
    state.models = state.models.filter((x) => x.id !== id);
    if (m.images) {
      for (const img of m.images) {
        if (imageURLs.has(img.path)) {
          URL.revokeObjectURL(imageURLs.get(img.path));
          imageURLs.delete(img.path);
        }
      }
    }
    $("#modal").close();
    render();
    toast("Modèle supprimé de votre collection.");
    requestSync(true);
  } catch (error) {
    toast(displayError(error));
  }
}
function detail(id) {
  const m = state.models.find((x) => x.id === id);
  if (!m) return;
  if (state.selecting) {
    toggleSelect(id);
    return;
  }
  state.detailId = id;
  state.detailPhoto = 0;
  const isOwner = Boolean(state.user && m.user_id === state.user.id);
  modal(
    m.name,
    `${isOwner ? `<button class="secondary detail-edit" type="button" data-action="edit-model">${icon("create")}Modifier le modèle</button>` : ""}${photo(m, "detail-image")}${m.reference ? `<p class="badge" style="margin-top:16px">Réf. ${esc(m.reference)}</p>` : ""}<p class="muted" style="margin-top:12px">${esc([m.category, m.subcategory].filter(Boolean).join(" · ") || "Non classé")}</p>${m.images.length > 1 ? `<div class="detail-thumbs">${m.images.map((i, n) => `<button data-image="${n}" aria-label="Photo ${n + 1}">${i.url ? `<img src="${esc(i.url)}" alt="Photo ${n + 1}">` : `<span>Photo ${n + 1}</span>`}</button>`).join("")}</div>` : ""}${m.sync_status === "conflict" ? `<p class="inline-error">${esc(m.sync_error)}</p><form id="fix-reference"><label>Nouvelle référence (facultatif)<input name="reference" maxlength="40" value="${esc(m.reference)}"></label><button class="secondary" type="submit">Corriger et réessayer</button></form>` : ""}${m.sync_status === "quota" ? `<p class="inline-error">Cette fiche reste sur cet appareil. Renouvelez votre offre ou rechargez vos ajouts pour la retrouver sur vos autres appareils.</p><button class="secondary" data-action="checkout">Gérer mon offre</button>` : ""}<button class="primary" style="width:100%;margin-top:20px" data-action="share-one">${icon("share")}Choisir les photos à partager</button>${isOwner ? `<div class="row" style="margin-top:12px;gap:10px"><button class="danger-text" type="button" data-action="delete-model" style="flex:1;margin-top:0">${icon("close")}Supprimer</button></div>` : ""}`,
  );
  $("#modal").classList.add("model-detail");
}
function toggleSelect(id) {
  state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
  $("#results").innerHTML = results();
}
const sharing = createPhotoShare({
  doc: document,
  getAccountKey: () => (state.user ? state.user.id + ":" + dataEpoch : null),
  modal,
  toast,
  async loadPhoto(path, key) {
    const owner = key.split(":")[0];
    if (!path?.startsWith(owner + "/"))
      throw Error("Photo étrangère au compte.");
    let data = await getPhoto(path);
    if (data) return data;
    if (!client || !navigator.onLine) return null;
    if (key !== state.user?.id + ":" + dataEpoch) return null;
    const result = await client.storage.from("model-images").download(path);
    if (result.error) throw result.error;
    data = result.data;
    return (await cachePhoto(owner, path, data)) ? data : null;
  },
});
async function prepareShare(ids) {
  const owner = state.user?.id;
  if (!owner) return;
  return sharing.open(
    state.models.filter((m) => m.user_id === owner && ids.includes(m.id)),
  );
}
function profileAction(action) {
  if (action === "help") {
    modal(
      "Comment utiliser MODEXA",
      `<div class="modal-copy"><p><strong>1. Ajouter</strong><br>Ajoutez au moins une photo, choisissez une catégorie puis une sous-catégorie. Seule la référence est facultative. Pour modifier un modèle, ouvrez sa photo puis touchez « Modifier le modèle ».</p><p><strong>2. Classer et retrouver</strong><br>Parcourez vos catégories ou recherchez un nom, une taille ou une référence.</p><p><strong>3. Sélectionner et partager</strong><br>Dans le catalogue, touchez « Sélectionner », choisissez vos modèles puis partagez sur WhatsApp.</p><p>Vos photos personnelles sont accessibles uniquement depuis votre compte. Le partage transmet les images aux destinataires que vous choisissez.</p></div>`,
    );
    return;
  }
  if (action === "settings") {
    modal(
      "Paramètres",
      `<div class="modal-copy"><p><strong>Apparence</strong><br>Thème sombre MODEXA</p><p><strong>Langue</strong><br>Français</p></div><button class="secondary" style="margin-top:20px" data-action="refresh">Actualiser le catalogue</button>`,
    );
    return;
  }
  if (!state.user) {
    auth();
    return;
  }
  if (action === "personal")
    modal(
      "Informations personnelles",
      `<form id="personal-form" class="dialog-form"><label>Nom de votre boutique<input name="full_name" value="${esc(state.user.user_metadata?.full_name || "")}" required maxlength="80"></label><p class="muted">${esc(state.user.email || state.user.phone)}</p><p id="personal-error" class="inline-error" role="alert"></p><button class="primary">Enregistrer</button></form>`,
    );
  if (action === "subscription") billing.show();
}
document.addEventListener("input", (e) => {
  if (e.target.id === "search") {
    state.query = e.target.value;
    $("#results").innerHTML = results();
  }
  if (e.target.closest("#add-form") && e.target.name) {
    state.draft[e.target.name] = e.target.value;
    if ($("#save-error")) $("#save-error").textContent = "";
    scheduleDraft();
  }
  if (e.target.id === "edit-reference" && editDraft) {
    editDraft.reference = e.target.value;
    if ($("#edit-error")) $("#edit-error").textContent = "";
  }
});
document.addEventListener("change", (e) => {
  if (["file-input", "camera-input"].includes(e.target.id)) {
    addFiles([...e.target.files]);
    e.target.value = "";
  }
  if (["edit-file-input", "edit-camera-input"].includes(e.target.id)) {
    addEditFiles([...e.target.files]);
    e.target.value = "";
  }
  if (e.target.name === "category" && e.target.closest("#add-form")) {
    state.draft.category = e.target.value;
    state.draft.subcategory = "";
    const select = $("[name=subcategory]");
    select.disabled = !e.target.value;
    select.innerHTML = subcategoryOptions(e.target.value);
    if ($("#save-error")) $("#save-error").textContent = "";
    scheduleDraft();
  }
  if (e.target.name === "subcategory" && e.target.closest("#add-form")) {
    if ($("#save-error")) $("#save-error").textContent = "";
  }
  if (e.target.id === "edit-category" && editDraft) {
    editDraft.category = e.target.value;
    editDraft.subcategory = "";
    const select = $("#edit-subcategory");
    if (select) {
      select.disabled = !e.target.value;
      select.innerHTML = subcategoryOptions(e.target.value);
    }
    if ($("#edit-error")) $("#edit-error").textContent = "";
  }
  if (e.target.id === "edit-subcategory" && editDraft) {
    editDraft.subcategory = e.target.value;
    if ($("#edit-error")) $("#edit-error").textContent = "";
  }
});
document.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.id === "fix-reference") {
    const active = accountGuard();
    const reference =
      String(new FormData(f).get("reference") || "").trim() || null;
    await changeModel(state.user.id, state.detailId, { reference });
    if (!active()) return;
    $("#modal").close();
    await loadLocal();
    requestSync();
    return;
  }
  if (f.id === "add-form") await saveModel(f);
  if (f.id === "edit-form") await saveEditedModel(f);
  if (f.id === "auth-form") await submitAuth(f);
  if (f.id === "otp-form") {
    const button = f.querySelector("button");
    button.disabled = true;
    const { error } = await client.auth.verifyOtp({
      phone: state.pendingPhone,
      token: new FormData(f).get("token"),
      type: "sms",
    });
    if (error) {
      $("#auth-error").textContent = displayError(error);
      button.disabled = false;
    } else {
      $("#modal").close();
      toast("Votre téléphone est confirmé.");
    }
  }
  if (f.id === "personal-form") {
    const active = accountGuard();
    const button = f.querySelector("button");
    button.disabled = true;
    const { data, error } = await client.auth.updateUser({
      data: { full_name: String(new FormData(f).get("full_name")).trim() },
    });
    if (!active()) return;
    if (error) {
      $("#personal-error").textContent = displayError(error);
      button.disabled = false;
    } else {
      state.user = data.user;
      $("#modal").close();
      render();
      toast("Informations enregistrées.");
    }
  }
});
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  try {
    if (b.dataset.page) {
      navigate(b.dataset.page);
      return;
    }
    if (b.dataset.subcategory) {
      state.category = b.dataset.parent;
      state.subcategory = b.dataset.subcategory;
      state.query = "";
      state.favorites = false;
      navigate("gallery");
      return;
    }
    if (b.dataset.category) {
      state.category = b.dataset.category;
      state.subcategory = "";
      state.query = "";
      state.favorites = false;
      navigate("subcategories");
      return;
    }
    if (b.dataset.favorite) {
      await favorite(b.dataset.favorite);
      return;
    }
    if (b.dataset.model) {
      detail(b.dataset.model);
      hydratePhotos().catch(() => {});
      return;
    }
    if (b.dataset.select) {
      toggleSelect(b.dataset.select);
      return;
    }
    if (authBusy && (b.dataset.auth || b.dataset.action === "toggle-signup"))
      return;
    if (b.dataset.auth) {
      state.authMethod = b.dataset.auth;
      auth();
      return;
    }
    if (b.dataset.remove !== undefined) {
      const [removed] = state.files.splice(Number(b.dataset.remove), 1);
      URL.revokeObjectURL(removed.preview);
      $("#uploads").innerHTML = uploads();
      $("#photo-count").textContent = `${state.files.length}/10 photos`;
      if ($("#save-error")) $("#save-error").textContent = "";
      scheduleDraft();
      return;
    }
    if (b.dataset.editRemoveOld !== undefined) {
      const idx = Number(b.dataset.editRemoveOld);
      if (editDraft) {
        editDraft.images.splice(idx, 1);
        renderEditModal();
      }
      return;
    }
    if (b.dataset.editRemoveNew !== undefined) {
      const idx = Number(b.dataset.editRemoveNew);
      if (editDraft) {
        const [removed] = editDraft.newFiles.splice(idx, 1);
        if (removed?.preview) URL.revokeObjectURL(removed.preview);
        renderEditModal();
      }
      return;
    }
    if (b.dataset.image !== undefined) {
      const m = state.models.find((m) => m.id === state.detailId);
      state.detailPhoto = Number(b.dataset.image);
      $(".detail-image").outerHTML = photo(
        { ...m, images: [m.images[state.detailPhoto]] },
        "detail-image",
      );
      hydratePhotos().catch(() => {});
      return;
    }
    const action = b.dataset.action;
    if (action === "show-password") {
      const input = b.closest(".password-field").querySelector("input");
      input.type = input.type === "password" ? "text" : "password";
      b.textContent = input.type === "password" ? "Afficher" : "Masquer";
      b.setAttribute("aria-label", b.textContent + " le mot de passe");
    } else if (action === "more") {
      state.visibleCount += 60;
      $("#results").innerHTML = results();
      hydratePhotos().catch(() => {});
    } else if (action === "retry-sync") {
      requestSync(true);
    } else if (action === "logout-confirm") {
      await logoutNow();
    } else if (action === "category-models") {
      state.subcategory = "";
      state.query = "";
      state.favorites = false;
      navigate("gallery");
    } else if (action === "close") $("#modal").close();
    else if (action === "back")
      navigate(previousPage === "profile" ? "home" : previousPage);
    else if (action === "all" || action === "search") {
      state.query = "";
      state.category = "";
      state.subcategory = "";
      state.favorites = false;
      navigate("gallery");
      if (action === "search") $("#search").focus();
    } else if (action === "forgot-password") {
      if (!authBusy) recovery.open(state.authMethod);
    } else if (action === "auth") auth();
    else if (action === "toggle-signup") {
      state.signup = !state.signup;
      auth();
    } else if (action === "pick") $("#file-input").click();
    else if (action === "camera") $("#camera-input").click();
    else if (action === "edit-model") editModelModal(state.detailId);
    else if (action === "edit-pick") $("#edit-file-input")?.click();
    else if (action === "edit-camera") $("#edit-camera-input")?.click();
    else if (action === "favorites" || action === "show-all") {
      state.favorites = action === "favorites";
      render();
    } else if (action === "clear-category") {
      state.category = "";
      state.subcategory = "";
      render();
    } else if (action === "select") {
      state.selecting = !state.selecting;
      state.selected.clear();
      $("#results").innerHTML = results();
    } else if (action === "select-all") {
      state.selected = new Set(filtered().map((m) => m.id));
      $("#results").innerHTML = results();
    } else if (action === "share") await prepareShare([...state.selected]);
    else if (action === "share-one") await prepareShare([state.detailId]);
    else if (action === "delete-model") {
      const m = state.models.find((x) => x.id === state.detailId);
      if (!m) return;
      modal(
        "Supprimer ce modèle",
        `<p class="modal-copy">Voulez-vous vraiment supprimer définitivement « <strong>${esc(m.name)}</strong> »${m.reference ? ` (réf. ${esc(m.reference)})` : ""} de votre catalogue ? Cette action est irréversible.</p><div class="form-actions"><button type="button" class="secondary" data-action="close">Annuler</button><button type="button" class="primary danger-btn" data-action="confirm-delete">Supprimer définitivement</button></div>`,
      );
    } else if (action === "confirm-delete") {
      await deleteModel(state.detailId);
    } else if (action === "logout") {
      await logoutNow();
    } else if (action === "refresh") {
      $("#modal").close();
      await refresh();
    } else if (action === "checkout") {
      billing.show();
    } else if (
      ["personal", "subscription", "settings", "help"].includes(action)
    )
      profileAction(action);
  } catch (error) {
    toast(displayError(error));
  }
});
$("#modal").addEventListener("click", (e) => {
  if (e.target === $("#modal")) {
    const r = e.target.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      e.target.close();
  }
});
// Load the SDK without delaying access to the locally saved session and catalogue.
function loadAuthSDK() {
  if (window.supabase) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "vendor/supabase.js";
    script.async = true;
    script.onload = resolve;
    script.onerror = () =>
      reject(
        Error(
          "Connexion indisponible. Vérifiez internet et actualisez MODEXA.",
        ),
      );
    document.head.append(script);
  });
}
async function restoreLocalSession() {
  await openDB();
  if (recovery.active) {
    state.booting = false;
    recovery.render();
    return;
  }
  const cached = await storedSession();
  state.booting = false;
  if (cached?.user?.id) await acceptUser(cached.user, false);
  else render();
}
async function connectCloud(sdkReady) {
  try {
    const sdkError = await sdkReady;
    if (sdkError) throw sdkError;
    await migrateSession(window.MODEXA_CONFIG);
    client = makeClient();
    state.authReady = true;
    client.auth.onAuthStateChange((event, session) => {
      const revision = ++authRevision;
      if (recovery.handleAuth(event, session)) return;
      if (event === "SIGNED_OUT") {
        clearUser();
        return;
      }
      if (state.user && session?.user?.id !== state.user.id) clearUser();
      setTimeout(() => {
        if (revision === authRevision && session?.user && !recovery.active)
          acceptUser(session.user).catch(() => {});
      }, 0);
    });
    const revision = authRevision;
    const { data, error } = await client.auth.getSession();
    if (recovery.active) {
      if (error) recovery.connectionError(error);
      else recovery.ready();
      return;
    }
    if (revision !== authRevision) return;
    if (data.session) await acceptUser(data.session.user);
    else if (!error && state.user) clearUser();
    else if (error && !state.user) {
      state.initError = authMessage(error);
      if ($("#auth-error")) $("#auth-error").textContent = state.initError;
    }
  } catch (error) {
    state.initError = authMessage(error);
    recovery.connectionError(error);
    if (!state.user && $("#auth-error"))
      $("#auth-error").textContent = state.initError;
  }
}
async function initialize() {
  recovery.arrive();
  render();
  const sdkReady = loadAuthSDK().then(
    () => null,
    (error) => error,
  );
  try {
    await restoreLocalSession();
  } catch (error) {
    state.booting = false;
    state.initError =
      error?.name === "SecurityError"
        ? "Le stockage local est bloqué. Autorisez le stockage du site dans votre navigateur."
        : authMessage(error);
    render();
  }
  // Network refresh and worker registration never block the first useful screen.
  connectCloud(sdkReady);
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("./sw.js", { type: "module" })
      .then((r) => {
        swRegistration = r;
        return navigator.serviceWorker.ready;
      })
      .then(() => requestSync())
      .catch(() => {
        state.backgroundUnavailable = true;
      });
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data?.type === "MODEXA_SYNC") scheduleLocalRefresh();
    });
  }
  window.addEventListener("online", () => {
    requestSync(true);
    render();
  });
  window.addEventListener("offline", () => render());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") requestSync(true);
    else {
      persistDraft();
      scheduleBackground(true);
    }
  });
  setInterval(() => {
    if (
      state.user &&
      document.visibilityState === "visible" &&
      navigator.onLine
    )
      requestSync();
  }, 30000);
  if (new URLSearchParams(location.search).has("payment")) {
    history.replaceState({}, "", location.pathname);
    toast("Vérification du paiement en cours.");
    requestSync(true);
  }
}
if (document.modelContext?.registerTool) {
  try {
    Promise.resolve(
      document.modelContext.registerTool({
        name: "search_models",
        title: "Rechercher des modèles",
        description:
          "Rechercher dans le catalogue du compte connecté et afficher les résultats.",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string", maxLength: 200 } },
          required: ["query"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute(input) {
          if (typeof input?.query !== "string" || input.query.length > 200)
            throw Error("Recherche invalide");
          state.query = input.query;
          state.category = "";
          state.subcategory = "";
          state.favorites = false;
          navigate("gallery");
          return {
            models: filtered().map(({ id, name, reference, category }) => ({
              id,
              name,
              reference,
              category,
            })),
          };
        },
      }),
    ).catch(() => {});
  } catch {}
}
function safeRender() {
  if (state.page !== "add") render();
}
function scheduleLocalRefresh() {
  clearTimeout(localRefreshTimer);
  localRefreshTimer = setTimeout(() => loadLocal().catch(() => {}), 150);
}
async function loadLocal() {
  const owner = state.user?.id,
    active = accountGuard();
  if (!owner) return;
  const [rows, deleted, usage] = await Promise.all([
    listModels(owner),
    getMeta(`deleted:${owner}`),
    getMeta(`usage:${owner}`),
  ]);
  if (!active()) return;
  state.pendingDeletes = (deleted || []).length;
  if (usage) {
    state.usage = usage;
    state.billingKnown = true;
    if (usage.subscription) state.subscription = usage.subscription;
  }
  state.models = rows
    .filter((m) => m.user_id === owner)
    .map((m) => ({
      ...m,
      images: m.images.map((i) => ({ ...i, url: imageURLs.get(i.path) })),
    }));
  safeRender();
}
let photoRun = false;
async function hydratePhotos() {
  if (photoRun || !state.user) return;
  photoRun = true;
  const owner = state.user.id,
    active = accountGuard();
  try {
    const ids = new Set(
      [...document.querySelectorAll("[data-model]")].map(
        (el) => el.dataset.model,
      ),
    );
    if ($("#modal").open && state.detailId) ids.add(state.detailId);
    const work = state.models
      .filter((m) => ids.has(m.id))
      .flatMap((m) =>
        m.images
          .filter((_, n) => n === 0 || m.id === state.detailId)
          .map((i) => ({ m, i })),
      )
      .filter(({ i }) => !imageURLs.has(i.path));
    let cursor = 0;
    await Promise.all(
      [0, 1, 2].map(async () => {
        while (cursor < work.length) {
          const { m, i } = work[cursor++];
          if (!active()) return;
          if (m.user_id !== owner || !i.path?.startsWith(owner + "/")) continue;
          let blob = await getPhoto(i.path);
          if (!active()) return;
          if (!blob && navigator.onLine && client) {
            const result = await client.storage
              .from("model-images")
              .download(i.path);
            if (!result.error) {
              blob = result.data;
              try {
                if (!(await cachePhoto(owner, i.path, blob))) continue;
                await setMeta(`uploaded:${i.path}`, true);
              } catch {}
            }
          }
          if (
            !blob ||
            !active() ||
            !state.models
              .find((row) => row.id === m.id)
              ?.images.some((image) => image.path === i.path)
          )
            continue;
          const url = URL.createObjectURL(blob);
          imageURLs.set(i.path, url);
          i.url = url;
          const current = state.models.find((x) => x.id === m.id);
          if (current) {
            const image = current.images.find((x) => x.path === i.path);
            if (image) image.url = url;
          }
          const cover = document.querySelector(`[data-model="${m.id}"]`);
          if (cover && m.images[0].path === i.path) {
            cover.innerHTML =
              photo(
                {
                  ...m,
                  images: m.images.map((x) => ({
                    ...x,
                    url: imageURLs.get(x.path),
                  })),
                },
                "product-image",
              ) +
              (m.reference
                ? `<span class="ref-tag">${esc(m.reference)}</span>`
                : "");
          }
          if ($("#modal").open && state.detailId === m.id) {
            const thumb = $(
              `[data-image="${m.images.findIndex((x) => x.path === i.path)}"]`,
            );
            if (thumb)
              thumb.innerHTML = `<img src="${esc(url)}" alt="Photo du modèle">`;
          }
          if (
            $("#modal").open &&
            state.detailId === m.id &&
            $(".detail-image") &&
            m.images[state.detailPhoto || 0]?.path === i.path
          ) {
            $(".detail-image").outerHTML = photo(
              { ...m, images: [{ url }] },
              "detail-image",
            );
          }
        }
      }),
    );
  } finally {
    if (active()) photoRun = false;
  }
}
function scheduleDraft() {
  draftVersion++;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(persistDraft, 200);
}
function persistDraft() {
  if (!state.user || saveBusy) return;
  const version = draftVersion,
    owner = state.user.id,
    value = {
      draft: { ...state.draft },
      files: state.files.map((p) => p.file),
    };
  draftWrite = draftWrite
    .catch(() => {})
    .then(() => {
      if (!saveBusy && state.user?.id === owner && version === draftVersion)
        return setMeta(`draft:${owner}`, value);
    })
    .catch(() => {
      toast(
        "Le brouillon ne peut pas être conservé sur cet appareil. Gardez cette page ouverte.",
      );
    });
}
async function acceptUser(user, network = true) {
  const changed = state.user?.id !== user.id;
  if (changed) clearUser();
  state.user = user;
  state.booting = false;
  const active = accountGuard();
  if (changed) {
    const owner = user.id;
    render();
    // Restore the catalogue first; independent draft and subscription reads run alongside it.
    await Promise.all([
      loadLocal(),
      (async () => {
        const [draft, subscription, usage] = await Promise.all([
          getMeta(`draft:${owner}`),
          getMeta(`subscription:${owner}`),
          getMeta(`usage:${owner}`),
        ]);
        if (!active()) return;
        state.draft = draft?.draft || {
          reference: "",
          category: "",
          subcategory: "",
        };
        state.files = (draft?.files || []).map((file) => ({
          file,
          preview: URL.createObjectURL(file),
        }));
        state.subscription = subscription || null;
        state.usage = usage || null;
        state.billingKnown = Boolean(usage);
      })(),
    ]);
  }
  if (active() && network) {
    requestSync(true);
    billing.checkPayment().catch(() => {});
  }
}
function clearUser() {
  clearTimeout(syncRetryTimer);
  billing.reset();
  sharing.reset();
  draftVersion++;
  clearTimeout(localRefreshTimer);
  clearTimeout(toastTimer);
  $("#toast").textContent = "";
  $("#toast").classList.remove("show");
  editDraft?.newFiles.forEach((p) => URL.revokeObjectURL(p.preview));
  saveBusy = false;
  editBusy = false;
  photoRun = false;
  dataEpoch++;
  clearTimeout(draftTimer);
  state.booting = false;
  $("#modal").close();
  $("#modal").innerHTML = "";
  state.detailId = null;
  editDraft = null;
  state.user = null;
  state.models = [];
  state.subscription = null;
  state.usage = null;
  state.billingKnown = false;
  state.page = "home";
  state.syncMessage = "";
  state.syncing = false;
  state.query = "";
  state.category = "";
  state.subcategory = "";
  state.favorites = false;
  state.selecting = false;
  state.pendingDeletes = 0;
  state.loadError = null;
  for (const url of imageURLs.values()) URL.revokeObjectURL(url);
  imageURLs.clear();
  state.files.forEach((p) => URL.revokeObjectURL(p.preview));
  state.files = [];
  state.draft = { reference: "", category: "", subcategory: "" };
  state.selected.clear();
  render();
}
async function logoutNow() {
  const owner = state.user?.id;
  if (!owner) return;
  clearTimeout(draftTimer);
  persistDraft();
  await draftWrite;
  if (state.user?.id !== owner) return;
  const { error } = await client.auth.signOut({ scope: "local" });
  // Explicit logout always removes local access, including when the network is unavailable.
  if (state.user && state.user.id !== owner) return;
  const cached = await storedSession();
  if (cached?.user?.id && cached.user.id !== owner) return;
  await removeMeta(AUTH_KEY);
  clearUser();
  $("#modal").close();
  // Keep the owner's catalogue and drafts for their next login, never expose them signed out.
  toast("Vous êtes déconnecté.");
}
async function scheduleBackground(run = false) {
  if (!state.user || !swRegistration) return;
  try {
    if (swRegistration.sync)
      await swRegistration.sync.register("modexa-upload");
  } catch {}
  if (run) swRegistration.active?.postMessage({ type: "MODEXA_SYNC_NOW" });
}
function requestSync(pull = false) {
  if (!client || !state.user) return;
  scheduleBackground();
  if (!navigator.onLine) return;
  if (syncRun) {
    state.syncAgain = true;
    state.pullAgain ||= pull;
    return syncRun;
  }
  billing.refresh().catch(() => {});
  const owner = state.user.id;
  state.syncing = true;
  state.syncMessage = "";
  safeRender();
  syncRun = (async () => {
    try {
      const health = await getMeta(`sync-health:${owner}`);
      if (!pull && health?.nextRetry > Date.now()) {
        clearTimeout(syncRetryTimer);
        syncRetryTimer = setTimeout(
          () => requestSync(true),
          health.nextRetry - Date.now(),
        );
        return;
      }
      const ran = await runBackgroundSync(
        client,
        owner,
        scheduleLocalRefresh,
        pull,
      );
      if (!ran) {
        clearTimeout(syncRetryTimer);
        syncRetryTimer = setTimeout(() => requestSync(true), 5000);
      }
      if (ran && pull && state.user?.id === owner) {
        const sub = await client
          .from("subscriptions")
          .select("*")
          .eq("user_id", owner)
          .maybeSingle();
        if (!sub.error) {
          await setMeta(`subscription:${owner}`, sub.data);
          if (state.user?.id === owner) state.subscription = sub.data;
        }
      }
    } catch (error) {
      if (state.user?.id === owner) {
        const health = await getMeta(`sync-health:${owner}`).catch(() => null);
        clearTimeout(syncRetryTimer);
        syncRetryTimer = setTimeout(
          () => requestSync(true),
          Math.max(
            5000,
            (health?.nextRetry || Date.now() + retryDelay(1)) - Date.now(),
          ),
        );
      }
    } finally {
      state.syncing = false;
      syncRun = null;
      if (state.user?.id === owner) {
        await loadLocal();
        billing.refresh().catch(() => {});
      }
      if (state.syncAgain || state.pullAgain) {
        const pullNext = Boolean(state.pullAgain);
        state.syncAgain = false;
        state.pullAgain = false;
        setTimeout(() => requestSync(pullNext), 500);
      }
    }
  })();
  return syncRun;
}

initialize();
