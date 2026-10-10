import { normalizePhone, authMessage } from "./auth-utils.js";

const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function validatePasswords(password, confirmation) {
  if (password.length < 8)
    throw Error("Choisissez un mot de passe d’au moins 8 caractères.");
  if (password !== confirmation)
    throw Error("Les deux mots de passe doivent être identiques.");
}

export function createAccountRecovery({
  doc,
  getClient,
  onStart,
  onComplete,
  onCancel,
}) {
  const win = doc.defaultView;
  let active = false,
    stage = "request",
    method = "email",
    phone = "",
    userId = null,
    busy = false,
    generation = 0;
  const fragment = new URLSearchParams(win.location.hash.slice(1));
  const arriving =
    fragment.get("type") === "recovery" ||
    fragment.get("error_code") === "otp_expired";
  function message(text) {
    const el = doc.querySelector("#recovery-message");
    if (el) el.textContent = text;
  }
  function render() {
    if (!active) return;
    const target = doc.querySelector("#app");
    // Preserve typed passwords and codes during background refreshes.
    if (target.querySelector(`[data-recovery-stage="${stage}"]`)) return;
    const input =
      method === "phone"
        ? '<label>Numéro de téléphone<input name="phone" type="tel" autocomplete="tel" placeholder="+228 90 12 34 56" required></label>'
        : '<label>Adresse e-mail<input name="email" type="email" autocomplete="email" required></label>';
    const body =
      stage === "request"
        ? `<p>Recevez ${method === "phone" ? "un code par SMS" : "un lien par e-mail"} pour choisir un nouveau mot de passe.</p>${input}<button class="primary" type="submit">${method === "phone" ? "Recevoir le code" : "Recevoir le lien"}</button>`
        : stage === "sent"
          ? '<p>Si un compte correspond à cette adresse, un lien vous sera envoyé. Consultez aussi vos courriers indésirables.</p><button class="secondary" type="button" data-recovery-action="restart">Demander un autre lien</button>'
          : stage === "code"
            ? `<p>Saisissez le code reçu au ${escape(phone)}.</p><label>Code SMS<input name="token" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label><button class="primary" type="submit">Vérifier le code</button><button type="button" class="text-button" data-recovery-action="restart">Renvoyer un code</button>`
            : stage === "password"
              ? '<label>Nouveau mot de passe<input name="password" type="password" autocomplete="new-password" minlength="8" required></label><label>Confirmer le mot de passe<input name="password_confirmation" type="password" autocomplete="new-password" minlength="8" required></label><button class="primary" type="submit">Enregistrer le mot de passe</button>'
              : "<p>Vérification de votre lien…</p>";
    target.innerHTML = `<main class="auth-page"><div class="auth-brand wordmark">MODEXA<span>.</span></div><section class="auth-card"><h1>Mot de passe oublié</h1><form id="recovery-form" class="dialog-form" data-recovery-stage="${stage}">${body}<p id="recovery-message" class="inline-error" role="alert"></p></form><button class="text-button" type="button" data-recovery-action="cancel">Retour à la connexion</button></section></main>`;
  }
  function show(next) {
    stage = next;
    doc.querySelector("#app").innerHTML = "";
    render();
  }
  function open(selected = "email") {
    generation++;
    active = true;
    busy = false;
    userId = null;
    method = selected;
    onStart();
    show("request");
  }
  function arrive() {
    if (!arriving) return false;
    active = true;
    onStart();
    show("waiting");
    if (fragment.has("error_code")) {
      show("request");
      message("Ce lien est invalide ou a expiré. Demandez un nouveau lien.");
      win.history.replaceState(
        {},
        "",
        win.location.pathname + win.location.search,
      );
    }
    return true;
  }
  function handleAuth(event, session) {
    if (event === "PASSWORD_RECOVERY" && session?.user) {
      generation++;
      active = true;
      busy = false;
      onStart();
      userId = session.user.id;
      show("password");
      return true;
    }
    if (!active) return false;
    if (event === "SIGNED_OUT" && userId) {
      generation++;
      userId = null;
      busy = false;
      show("request");
      message("Votre lien a expiré. Demandez un nouveau lien ou code.");
    }
    if (session?.user && userId && session.user.id !== userId) {
      generation++;
      userId = null;
      busy = false;
      show("request");
      message("Le compte a changé. Recommencez la récupération.");
    }
    return true;
  }
  function connectionError(error) {
    if (active) {
      if (stage === "waiting") show("request");
      message(authMessage(error));
    }
  }
  function ready() {
    if (active && stage === "waiting") {
      show("request");
      message("Ce lien est invalide ou a expiré. Demandez un nouveau lien.");
    }
  }
  async function submit(form) {
    if (!active || busy) return;
    const client = getClient(),
      version = generation,
      valid = () => active && generation === version;
    if (!client) {
      message("MODEXA démarre. Réessayez dans un instant.");
      return;
    }
    if (!win.navigator.onLine) {
      message(
        "Une connexion internet est nécessaire pour récupérer votre compte.",
      );
      return;
    }
    const data = new win.FormData(form),
      buttons = [
        ...doc.querySelectorAll("[data-recovery-action],#recovery-form button"),
      ];
    busy = true;
    buttons.forEach((b) => (b.disabled = true));
    message("");
    try {
      if (stage === "request") {
        if (method === "phone") {
          phone = normalizePhone(data.get("phone"));
          const { error } = await client.auth.signInWithOtp({
            phone,
            options: { shouldCreateUser: false },
          });
          if (error) throw error;
          if (valid()) show("code");
        } else {
          const email = String(data.get("email") || "")
            .trim()
            .toLowerCase();
          const { error } = await client.auth.resetPasswordForEmail(email, {
            redirectTo: win.location.origin + win.location.pathname,
          });
          if (error) throw error;
          if (valid()) show("sent");
        }
      } else if (stage === "code") {
        const token = String(data.get("token") || "").trim();
        if (!/^\d{6}$/.test(token))
          throw Error("Saisissez les 6 chiffres du code reçu.");
        const { data: verified, error } = await client.auth.verifyOtp({
          phone,
          token,
          type: "sms",
        });
        if (error) throw error;
        if (!valid()) return;
        if (!verified.session?.user?.id)
          throw Error("Code invalide ou expiré. Demandez un nouveau code.");
        userId = verified.session.user.id;
        show("password");
      } else if (stage === "password") {
        const password = String(data.get("password") || "");
        validatePasswords(
          password,
          String(data.get("password_confirmation") || ""),
        );
        const { data: current, error: sessionError } =
          await client.auth.getUser();
        if (sessionError) throw sessionError;
        if (!valid()) return;
        if (!userId || current.user?.id !== userId)
          throw Error("Votre session a changé. Recommencez la récupération.");
        const { data: updated, error } = await client.auth.updateUser({
          password,
        });
        if (error) throw error;
        if (!valid()) return;
        active = false;
        userId = null;
        await onComplete(updated.user || current.user);
      }
    } catch (error) {
      if (valid()) {
        const text = /otp|expired|invalid.*token/i.test(
          error?.code + " " + error?.message,
        )
          ? "Code ou lien invalide ou expiré. Demandez-en un nouveau."
          : /sms|provider|sending.*email/i.test(error?.message || "")
            ? "L’envoi est indisponible pour le moment. Réessayez plus tard."
            : authMessage(error);
        message(text);
      }
    } finally {
      if (generation === version) {
        busy = false;
        buttons.forEach((b) => (b.disabled = false));
      }
    }
  }
  doc.addEventListener("submit", (event) => {
    if (event.target.id === "recovery-form") {
      event.preventDefault();
      submit(event.target);
    }
  });
  doc.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-recovery-action]")?.dataset
      .recoveryAction;
    if (!action || busy) return;
    if (action === "restart") {
      show("request");
      return;
    }
    if (action === "cancel") {
      generation++;
      active = false;
      userId = null;
      const client = getClient();
      if (client) {
        try {
          await client.auth.signOut({ scope: "local" });
        } catch {}
      }
      onCancel();
    }
  });
  return {
    get active() {
      return active;
    },
    open,
    arrive,
    render,
    handleAuth,
    connectionError,
    ready,
    submit,
  };
}
