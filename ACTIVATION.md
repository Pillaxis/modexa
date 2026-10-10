# Configuration de MODEXA V1

Ce document distingue les réglages attendus des vérifications à effectuer sur le service déployé. Le dépôt GitHub et les tests locaux ne prouvent pas à eux seuls que les mêmes migrations, fonctions ou paramètres sont actifs dans Supabase.

## Comptes et inscription

L'e-mail et le téléphone avec mot de passe restent utilisables **sans confirmation à l'inscription** pour la V1. Ne pas changer `mailer_autoconfirm` ou `phone_autoconfirm` pour mettre en place la récupération de compte. La confirmation du mot de passe dans le formulaire est une seconde saisie, indépendante de la vérification de l'adresse ou du numéro.

## Mot de passe oublié

Le code comprend les deux parcours : lien par e-mail et code SMS pour un compte existant. L'utilisateur choisit ensuite son nouveau mot de passe et le confirme.

À vérifier dans Supabase avant de considérer les envois opérationnels :

1. Le service SMTP et l'adresse d'expédition permettent l'envoi aux utilisateurs.
2. Le fournisseur SMS est configuré pour les comptes par téléphone. L'inscription sans SMS ne signifie pas que l'envoi de codes de récupération est disponible.
3. Dans [URL Configuration](https://supabase.com/dashboard/project/ulptjkyjsbswtzsinywl/auth/url-configuration), la Site URL et les Redirect URLs correspondent à l'origine réellement publiée. L'origine consignée est `https://modexa-boutique.nasserpillar4.chatgpt.site` ; pour les essais locaux, utiliser `http://127.0.0.1:4173/`.
4. Le modèle d'e-mail de récupération conserve le lien Supabase de récupération.
5. Vérifier sur un compte de recette : réception, lien/code expiré, confirmation différente, changement du mot de passe et connexion avec le nouveau mot de passe.

Les tests automatisés simulent ces parcours sans envoyer d'e-mail ou de SMS. Les services d'envoi n'ont pas été reconfigurés lors de cette correction.

## Base de données

Les migrations du dépôt définissent les modèles, abonnements, paiements et crédits avec règles RLS, ainsi que le stockage privé des images. Comparer leur liste à l'historique des migrations appliquées avant toute opération. Ne pas rejouer une migration déjà appliquée.

## Paiements FedaPay

Le propriétaire avait indiqué avoir configuré les secrets de production et le webhook. Cette information est historique : la configuration active n'a pas été relue lors de la correction du code. **Ne pas remplacer les clés live par des clés sandbox sur le projet de production.**

Les variables serveur requises sont :

- `FEDAPAY_ENVIRONMENT` : `live` en production, `sandbox` dans un environnement de recette distinct.
- `FEDAPAY_SECRET_KEY` et `FEDAPAY_WEBHOOK_SECRET` : secrets du même environnement.
- `APP_ORIGIN` : `https://modexa-sigma.vercel.app`, l'origine utilisée par l'application installée. Cette valeur autorise les appels du navigateur et fixe l'adresse de retour après paiement. Une modification sur GitHub ne met pas à jour cette variable Supabase.

Le webhook écoute `transaction.approved` à l'adresse :
`https://ulptjkyjsbswtzsinywl.supabase.co/functions/v1/fedapay-webhook`.

La recette doit couvrir les offres et prix du [README](README.md), les recharges, les expirations, un renouvellement anticipé et la répétition d'un webhook sans double crédit. Les durées sont de **30, 90 ou 360 jours**. Les recharges expirent 30 jours après paiement et exigent un abonnement principal actif.

Un paiement complet en production n'a pas été effectué par les tests locaux. Les secrets restent dans Supabase ; aucune clé d'administration ou de paiement ne doit être ajoutée aux fichiers du navigateur.
