# Développer MODEXA

Le projet à modifier et à publier est `C:\MODEXA\modexa`. Le site sert directement
`dist/` : ce dossier contient les sources de l'application, sans étape de build.

## Responsabilités des fichiers

| Fichier | Responsabilité |
| --- | --- |
| `dist/app.js` | Navigation, catalogue et coordination des écrans |
| `dist/account-recovery.js` | Récupération de compte et validation des deux mots de passe |
| `dist/auth-utils.js` | Numéros de téléphone et erreurs de connexion |
| `dist/local-store.js` | Transactions IndexedDB, fichiers et files persistantes |
| `dist/sync.js` | Envoi des fiches, suppressions et réception du catalogue |
| `dist/photo-cleanup.js` | Nettoyage distant des photos retirées après confirmation de la fiche |
| `dist/sync-runner.js` | Diagnostic local et délai de reprise après échec |
| `dist/sw.js` | Cache de l'application et exécution en arrière-plan |
| `dist/billing-ui.js`, `dist/plans.js` | Offres, quotas et paiements côté interface |
| `supabase/` | Migrations, règles d'accès et fonctions de paiement |
| `tests/`, `supabase/tests/` | Tests locaux, sans paiement ni compte réel |

## Commandes utiles

Depuis le dossier du projet :

```powershell
npm ci
npm run format
npm run format:check
npm run check
npm test
npm start
```

Les nouveaux modules doivent être ajoutés à la liste `ASSETS` de `dist/sw.js`.
Augmenter sa version `CACHE` à chaque livraison de changements dans `dist/`.
Conserver les formulaires ouverts pendant une mise à jour.

## Règles de fiabilité

- Une modification de photos écrit les nouvelles images, la fiche et la liste
  de nettoyage dans une transaction locale unique.
- Une photo retirée quitte le cache local. Sa copie distante n'est supprimée
  qu'après vérification qu'aucune version actuelle de la fiche ne la référence.
- Les demandes de nettoyage restent persistantes jusqu'à confirmation du stockage.
- Les erreurs réseau déclenchent une reprise avec délai croissant, sans message
  de progression dans l'interface. Les délais ne garantissent pas une exécution
  pendant que le système suspend le navigateur.
- `sync-health:<compte>` conserve uniquement les dates, compteurs et codes d'erreur
  pour le diagnostic local ; aucun jeton ni contenu de réponse n'y est journalisé.
- Une référence en conflit ou un quota épuisé ne doit jamais être contourné.
- La récupération vérifie le lien ou le code avant de changer le mot de passe.
  L'inscription V1 reste sans confirmation de l'adresse ou du numéro.

## Outils historiques hors du dépôt

Les scripts `*-smoke.mjs`, les scripts de modification `.cjs`, `verification/`,
`fedapay-sdk/`, les captures et l'archive de déploiement dans `C:\MODEXA` sont des
outils ou traces historiques. Ils ne constituent pas la procédure actuelle de
test ou de publication. Certains modifient Supabase ou réécrivent des fichiers.
Utiliser les commandes ci-dessus ; ne pas relancer ces scripts pour maintenir la V1.
Ils restent conservés à leur emplacement d'origine pour consultation.

## Vérification avant envoi GitHub

Exécuter les vérifications ci-dessus, inspecter le diff, puis publier uniquement
le projet. Les paramètres publics sont dans `dist/config.js` ; les secrets de
paiement et clés d'administration restent côté serveur. Ne pas écraser un
changement distant non examiné. L'historique Git local antérieur à l'import initial
sur GitHub est distinct de celui du dépôt ; comparer les fichiers avant de publier.
