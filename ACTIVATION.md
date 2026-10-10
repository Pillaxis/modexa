# Réglages restants de MODEXA

La base, les règles de confidentialité, le stockage privé et les fonctions de paiement sont installés. Il n'est plus nécessaire de copier le SQL.

## Inscription V1 : e-mail et téléphone +228

E-mail et téléphone sont activés, sans confirmation, à la demande du propriétaire pour la V1. Les réglages ont été vérifiés le 6 octobre 2026 : `email=true`, `phone=true`, `mailer_autoconfirm=true`, `phone_autoconfirm=true`. Aucun SMS de validation n'est envoyé. Les adresses et numéros ne sont pas vérifiés à l'inscription.

## Vérifications ultérieures

Pour réactiver les confirmations, configurer d'abord un fournisseur SMTP et un fournisseur SMS, puis les options correspondantes dans [Authentication du projet MODEXA](https://supabase.com/dashboard/project/ulptjkyjsbswtzsinywl/auth/providers).

Dans [URL Configuration](https://supabase.com/dashboard/project/ulptjkyjsbswtzsinywl/auth/url-configuration), définir l'URL de MODEXA comme Site URL et Redirect URL. Tant que le site n'est pas publié, utiliser `http://127.0.0.1:4173` pour les essais locaux. L'origine prévue après publication est `https://modexa-boutique.nasserpillar4.chatgpt.site`.

## FedaPay

1. Créer un webhook dans le tableau de bord FedaPay, événement `transaction.approved`, URL :
   `https://ulptjkyjsbswtzsinywl.supabase.co/functions/v1/fedapay-webhook`
2. Dans les [secrets Supabase](https://supabase.com/dashboard/project/ulptjkyjsbswtzsinywl/functions/secrets), ajouter directement :
   - `FEDAPAY_SECRET_KEY` : clé secrète FedaPay sandbox.
   - `FEDAPAY_WEBHOOK_SECRET` : secret du webhook sandbox.
   - `FEDAPAY_ENVIRONMENT` : `sandbox`.
   - `APP_ORIGIN` : URL publiée de MODEXA (ou origine locale pendant un essai local).
3. Vérifier les offres : Pro 7 000 / 18 900 / 58 800 XOF et Business 15 000 / 40 500 / 126 000 XOF pour 1 / 3 / 12 mois. Confirmer après paiement les quotas Pro 100 / 300 / 1 200 et Business 1 000 / 3 000 / 12 000, puis les recharges Pro 50/3 600 ou 100/7 000 et Business 500/7 600 ou 1 000/15 000. Vérifier l’épuisement, l’expiration indépendante de 30 jours des recharges, l’obligation de renouveler le principal, la conservation des anciens modèles et la répétition du webhook (aucun double crédit). Aucun paiement réel n'est effectué automatiquement par les tests.
4. Passer à `live` avec les clés et le webhook de production uniquement après validation.

Ne transmettez aucune clé secrète dans le chat et ne les ajoutez pas à `dist/config.js`. Le prix et la devise sont fixés côté serveur. Les abonnements se renouvellent manuellement ; aucun prélèvement automatique n'est effectué.
