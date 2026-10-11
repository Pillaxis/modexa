# MODEXA pour Android

Le projet Capacitor embarque `dist/` dans une application Android (`com.modexa.app`).
Le site et la PWA restent disponibles. L’ouverture directe de WhatsApp avec les
photos nécessite l’installation de cet APK Android ; une mise à jour du site ne
transforme pas une PWA déjà installée en application native.

## Compiler

Prérequis : Node.js 22 ou supérieur, JDK 21, Android Studio avec Android SDK 36.

```powershell
npm ci
npm run android:sync
npm run android:open
```

Dans Android Studio, attendre la synchronisation Gradle, puis utiliser **Build APK(s)**.
Ou, avec `JAVA_HOME` et `ANDROID_HOME` configurés :

```powershell
cd android
.\gradlew.bat assembleDebug
```

APK de test : `android/app/build/outputs/apk/debug/app-debug.apk`.
Pour une diffusion publique, générer une version **release signée** avec une clé
conservée en lieu sûr et hors Git. Incrémenter `versionCode` dans
`android/app/build.gradle` à chaque mise à jour. Relancer `android:sync` après
toute modification des fichiers web, avant la compilation.

## Fonctionnement et vérification sur téléphone

- Se connecter au même compte MODEXA. Le stockage de la PWA et celui de l’APK
  sont distincts : synchroniser les fiches de la PWA avant de changer d’application.
- Sélectionner une puis plusieurs photos et toucher « Partager sur WhatsApp ».
  Le plugin Android cible `com.whatsapp`, sans sélecteur d’application. Si seul
  WhatsApp Business est installé, il cible `com.whatsapp.w4b`. Si les deux sont
  installés, WhatsApp standard est prioritaire. L’utilisateur choisit encore le
  destinataire et confirme l’envoi dans WhatsApp.
- Sans WhatsApp installé, une erreur explicite apparaît. Aucun autre logiciel
  n’est proposé à sa place. Vérifier également annulation, nouvelle tentative,
  partage hors connexion avec photos locales et changement de compte.
- Les copies de partage restent dans le cache privé, exposées seulement par des
  URI FileProvider avec autorisation temporaire de lecture. Les préparations
  abandonnées sont effacées. Les copies transmises sont nettoyées au prochain
  démarrage ou partage après 24 heures. Limites : 20 photos, 10 Mo par photo,
  100 Mo par partage. Aucune permission globale d’accès aux fichiers.
- Vérifier FedaPay sur téléphone : indicateur « En cours… », ouverture du paiement,
  puis retour à MODEXA et « J’ai déjà payé · Vérifier mon paiement » si nécessaire.
  Aucun lien Android vérifié de retour automatique n’est configuré à ce stade.

Les fichiers embarqués utilisent l’origine HTTPS MODEXA déjà autorisée par le
serveur. `server.url` et la navigation externe dans le WebView ne sont pas activés.
Le service worker web n’est pas enregistré dans l’APK, pour conserver le pont natif.

Les tests JavaScript couvrent le routage natif, les erreurs et l’isolation des
comptes. La compilation Android et le partage réel doivent être validés avec
le SDK et un téléphone : ils ne sont pas remplacés par ces tests.
