# MODEXA

Application web mobile en français, noir #000, blanc #fff, orange #ff6600.

## État de livraison

- Installation directe uniquement : le bouton apparaît après une offre native `beforeinstallprompt`, puis ouvre immédiatement la confirmation du navigateur. Aucun panneau d’instructions ni fausse installation. Sans cette API (notamment Safari/iPhone et certains navigateurs intégrés), le bouton reste masqué ; le site reste utilisable. Une installation silencieuse universelle ne peut pas être imposée par une page web.
- Après acceptation native, le bouton disparaît ; seul un état « Installation en cours » reste jusqu’à `appinstalled`. Après installation ou en mode standalone/iOS/minimal-ui/window-controls-overlay, tout le bandeau disparaît. La confirmation est mémorisée entre visites. Icônes M noir/orange conservées. Les événements sont couverts par des tests simulés ; installation physique à vérifier sur le téléphone cible.
- Entrée obligatoire par connexion ou inscription (téléphone +228 en premier, ou e-mail). Sans session, aucun catalogue ni navigation n'est affiché. La session persistée ouvre directement le catalogue local au retour ; le SDK et la vérification réseau se chargent ensuite. Une session invalidée renvoie à la connexion.
- Ouverture locale et enregistrement testés sous une seconde dans JSDOM/IndexedDB simulé. Préchargement des petits modules prioritaires, aucun aller-retour réseau requis pour enregistrer : abonnement local connu, sinon capacité gratuite, avec enforcement serveur à la synchronisation. Les brouillons obsolètes en file sont ignorés. Les mises à jour ne rechargent plus les formulaires ouverts. Ces mesures ne garantissent pas une durée universelle : téléphone, taille des photos et première visite réseau restent déterminants.
- Interface : accueil avec « Ajoutés récemment » avant « Mes catégories », catégories puis page de sous-catégories, ajout de 1 à 10 photos, recherche instantanée, sélection multiple, favoris, partage, création IA à venir, profil séparé. En-tête épinglé pendant le défilement.
- Formulaires Ajouter et Modifier : au moins une photo, catégorie et sous-catégorie obligatoires ; référence facultative. Le nom est déduit du classement. Les anciennes fiches incomplètes restent lisibles ; compléter les champs lors de leur modification. La base reste compatible avec ces anciennes fiches et les files locales antérieures.
- Client Supabase configuré avec le projet `ulptjkyjsbswtzsinywl` et sa clé publique. Aucune clé secrète dans le navigateur.
- Enregistrement local prioritaire dans IndexedDB : modèles, photos, favoris et brouillon d'ajout. La confirmation apparaît après l’écriture locale, sans attendre Supabase. Une file persistante envoie ensuite les changements et reprend après interruption.
- Schéma SQL, bucket privé et fonctions FedaPay **déployés le 4 octobre 2026** dans le projet MODEXA. Les trois tables ont RLS activé ; seul `service_role` peut confirmer un paiement.
- Contrôles serveur effectués : création de paiement sans session refusée (401), notification sans signature refusée (400). E-mail et téléphone sont activés sans confirmation pour la V1, à la demande du propriétaire ; réglages publics vérifiés le 6 octobre 2026.
- Les secrets FedaPay live et le webhook ont été configurés par le propriétaire. La synchronisation entre deux appareils et l'activation Pro après paiement restent à valider de bout en bout.

## 1. Initialiser Supabase

Cette étape est déjà réalisée dans le projet MODEXA : **ne pas réexécuter le script**. Pour une nouvelle installation uniquement, appliquer les fichiers de `supabase/migrations/` dans l’ordre de leur nom, une seule fois chacun. La migration est transactionnelle et destinée à un projet sans ces tables. Elle crée :

- `models` : articles personnels, favoris et chemins de photos ; références uniques par commerçant, sans distinction majuscules/minuscules.
- `subscriptions` et `payments` : consultation par le propriétaire ; écritures réservées aux fonctions serveur.
- Bucket **privé** `model-images` : JPG/PNG/WebP, maximum 10 Mo/photo ; dossiers préfixés par l'identifiant authentifié.
- RLS sur chaque table et sur les objets de stockage ; contrôle de propriété également sur les chemins JSON.
- Confirmation des paiements idempotente dans une transaction SQL, avec prolongation d'un mois civil et verrouillage des lignes.

L’ajout écrit atomiquement la fiche et ses photos sur l’appareil. Le synchroniseur envoie les images sous des chemins déterministes, puis la fiche ; il conserve la file et les fichiers en cas d’échec. Les identifiants stables évitent de créer des doublons après une réponse réseau perdue. Les photos cloud sont téléchargées avec la session authentifiée et mises en cache dans IndexedDB au fil de la consultation. Aucun bucket public ni lien public permanent n’est créé.

## 2. Activer les comptes

Pour la V1, e-mail et téléphone + mot de passe fonctionnent sans confirmation. L'application propose +228 en premier. Aucun SMS de validation n'est envoyé. Les identifiants ne prouvent donc pas la possession du numéro ou de l'adresse. Pour rétablir la vérification ultérieurement, configurer un fournisseur SMS et SMTP avant de réactiver les confirmations.

E-mail/mot de passe est déjà activé. Configurer le service SMTP pour la production et les URL autorisées dans Authentication > URL Configuration :

- Site URL : `https://modexa-boutique.nasserpillar4.chatgpt.site`
- Redirect URLs : cette même origine et `http://127.0.0.1:4173` pour les essais locaux.

La session Supabase et le catalogue local restent dans IndexedDB pour maintenir la connexion et permettre la consultation hors connexion. Chaque fiche, photo et brouillon est séparé par identifiant de propriétaire. Le même compte retrouve les données déjà synchronisées sur un autre téléphone ; un nouvel appareil nécessite une connexion internet pour les récupérer. La connexion et les paiements nécessitent toujours le réseau.

## 3. Activer FedaPay

Renouvellement **manuel**, sans prélèvement automatique. Le gratuit conserve une capacité de 10 modèles. Les offres payantes donnent des **ajouts consommables**, et non une limite du catalogue existant.

| Offre | 1 mois (30 jours) | 3 mois (90 jours) | 12 mois (360 jours) |
| --- | --- | --- | --- |
| Pro | 100 ajouts · 7 000 FCFA | 300 ajouts · 18 900 FCFA | 1 200 ajouts · 58 800 FCFA |
| Business | 1 000 ajouts · 15 000 FCFA | 3 000 ajouts · 40 500 FCFA | 12 000 ajouts · 126 000 FCFA |

Recharges : Pro 50/3 600 FCFA ou 100/7 000 FCFA ; Business 500/7 600 FCFA ou 1 000/15 000 FCFA. Elles sont proposées lorsque tous les ajouts sont consommés et que l’abonnement principal est actif. Une nouvelle recharge est autorisée après épuisement de la précédente. Une recharge dure 30 jours après confirmation du paiement et ne prolonge pas l’abonnement principal.

Un renouvellement anticipé donne immédiatement un nouveau quota, valable jusqu’à la nouvelle échéance : temps restant + 30 jours par mois acheté. Les anciens lots gardent leur expiration. Chaque achat d’abonnement définit l’offre active ; les lots déjà achetés restent valables jusqu’à leur échéance. Les crédits qui expirent le plus tôt sont consommés en premier.

À l’expiration du principal, les ajouts sont bloqués, y compris avec une recharge encore valide. Le renouvellement réactive l’utilisation des recharges non expirées. Les modèles déjà enregistrés restent toujours consultables, modifiables et partageables. Supprimer un modèle payé ne restitue pas de crédit ; annuler un ajout local non encore envoyé ne consomme rien sur le serveur.

`model_credits` expose uniquement les lots du propriétaire via RLS. Le serveur sérialise les achats et ajouts par compte, vérifie les prix, consomme un crédit atomiquement et traite chaque paiement une seule fois. Les compteurs privés et les lots ne sont pas modifiables depuis le navigateur. Les ajouts hors ligne sont conservés localement ; si les droits ont expiré ou ont été consommés sur un autre appareil avant l’envoi, les ajouts restent locaux jusqu’à un renouvellement/rechargement. Les confirmations et compteurs locaux sont écrits atomiquement, et les anciennes réponses réseau ne restaurent pas de crédits consommés.


## Partage WhatsApp

Sur les navigateurs mobiles compatibles Web Share, les photos privées sont téléchargées avec la session puis passées au menu de partage natif : choisir WhatsApp. Les références sont conservées dans les noms des fichiers. Le sélecteur permet de choisir chaque photo ; jusqu’à 20 photos sont transmises en un seul appel. Le navigateur impose son menu de partage : aucune sélection forcée de WhatsApp et aucune garantie d’album côté destinataire. Les photos sont préparées avant le clic final pour conserver l’activation utilisateur exigée sur mobile.

Sur ordinateur ou navigateur incompatible, télécharger les photos puis ouvrir WhatsApp avec les références préremplies et joindre les fichiers. L'application explique cette différence, sans promettre un envoi de pièces jointes par une URL WhatsApp.

## Sauvegarde locale et arrière-plan

- L’écran reste utilisable pendant l’envoi. Les fichiers déjà envoyés ne sont pas retransmis lorsqu’un favori change.
- Les modèles récents apparaissent immédiatement ; les galeries chargent les cartes par groupes de 60 et les photos visibles avec trois téléchargements simultanés au maximum.
- Un conflit de référence reste local et se résout dans la fiche du modèle.
- La file reprend à l’ouverture, au retour du réseau, au retour dans l’application et périodiquement pendant son utilisation.
- Un service worker met les fichiers de l’application en cache et utilise Background Sync lorsque le navigateur le permet. **La poursuite après fermeture complète n’est pas garantie** : Safari/iOS et les restrictions du système peuvent suspendre les tâches. La file reprend à la prochaine ouverture. Ne pas effacer les données du navigateur avant la fin de l’envoi.
- La synchronisation est invisible : aucun bandeau, badge ou message de progression. La confirmation « Modèle enregistré » concerne l’écriture locale. Une déconnexion laisse la file sur cet appareil ; reconnectez-vous au même compte pour reprendre.
- Pour toute modification future des fichiers `dist/`, augmenter la version `CACHE` de `dist/sw.js` afin de renouveler la copie hors connexion.

## Lancement local

```powershell
npm ci
npm run check
npm test
npm start
```

Ouvrir `http://127.0.0.1:4173`. Aucun build nécessaire. Fichiers publiés : `dist/`. Client officiel Supabase JS 2.57.4 inclus localement. Aucun catalogue ni visuel de démonstration n’est embarqué.

## Vérifications de cette version

Tests automatisés : persistance de fichiers/brouillons, interruption réseau et reprise, absence de doublons, favoris modifiés pendant l’envoi, isolation locale, champs obligatoires à l’ajout/modification, référence facultative, synchronisation invisible, photos entières, navigation progressive, formulaire de connexion et cache du service worker. Les migrations sont aussi testées dans PostgreSQL embarqué avec vérification RLS et paiements.

Le 7 octobre 2026, des comptes temporaires ont validé sur Supabase l’inscription et la connexion e-mail/téléphone sans confirmation, la récupération d’un modèle facultatif dans une nouvelle session et son invisibilité pour l’autre compte. Un essai avec le vrai client et son stockage local a aussi validé l’envoi d’une photo, sa récupération privée, la mise à jour d’un favori et la suppression synchronisée. Les comptes temporaires ont été supprimés après les essais. La poursuite réelle après fermeture sur iPhone/Android, la recette visuelle de cette version et un paiement FedaPay complet restent à valider sur appareils.

Le dépôt contient le code, les migrations, les fonctions et les tests. `dist/config.js` ne contient que l’URL Supabase et la clé **publique publishable**. Les secrets FedaPay et service_role restent exclusivement dans Supabase.

## Sources techniques

Validation locale : migration exécutée dans PostgreSQL embarqué (PGlite), tests d'isolation de lecture/écriture entre deux comptes, stockage privé, interdiction de modifier les abonnements depuis un compte client, replay d'un paiement et renouvellement : réussis. Parcours de la première version vérifiés auparavant dans le navigateur : recherche par référence et sous-catégorie, sélection, préparation de partage, profil sans navigation, téléphone +228 et basculement e-mail. Ceci ne remplace pas la recette sur le projet Supabase ni un paiement sandbox FedaPay.

- [Supabase : authentification par mot de passe](https://supabase.com/docs/guides/auth/passwords)
- [Supabase : contrôle des accès au stockage](https://supabase.com/docs/guides/storage/security/access-control)
- [FedaPay : création de transaction](https://docs.fedapay.com/api-reference/transactions/create)
- [FedaPay : lien de paiement](https://docs.fedapay.com/api-reference/transactions/create-token)
- Signature : SDK officiel npm `fedapay@1.2.5`, module `Webhook`.

## Modification et consultation

Toucher la photo d’un modèle ouvre une fiche avec une image entière, sans recadrage, et le bouton « Modifier le modèle » placé au-dessus. Les photos peuvent être ajoutées ou retirées ; enregistrer exige au moins une photo et un classement complet. Les miniatures permettent de consulter chaque photo.

## Réinitialisation du 8 octobre 2026

À la demande explicite du propriétaire, les 2 comptes, 6 modèles, 2 photos et 1 enregistrement de paiement ont été supprimés du projet MODEXA. Les tables, le bucket privé, les règles RLS et les fonctions de paiement restent en place. Le catalogue démarre vide ; les catégories sont uniquement la structure de classement.

La version 2 d’IndexedDB efface une seule fois les données de l’ancienne version : photos locales, brouillons, file d’envoi et sessions. Les anciennes sessions localStorage ne sont plus migrées. Le service worker renouvelle le cache puis recharge les onglets à son activation. Sur un appareil hors ligne, ce nettoyage ne peut se produire qu’après réception de la mise à jour. Les nouveaux comptes et données créés après la réinitialisation persistent normalement.
