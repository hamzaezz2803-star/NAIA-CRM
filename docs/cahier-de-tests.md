# Cahier de tests fonctionnels — NAIA-os CRM

Cas de test manuels pour valider les modules CRM, Meetings et Docs Generator
sur un environnement de test (Supabase de test + `npm run dev`).

## Environnement et jeux de données

| Élément  | Valeur                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------ |
| URL      | `http://localhost:3000`                                                                                                  |
| Base     | Projet Supabase de test, 45 migrations appliquées                                                                        |
| Compte A | Utilisateur Google, rôle `owner`                                                                                         |
| Compte B | Utilisateur Google, rôle `member` (pour les tests de rôles)                                                              |
| Compte C | Utilisateur Google, rôle `viewer` (pour les tests de rôles)                                                              |
| Données  | Créer avant de commencer : 1 entreprise « Test Atlas SA », 1 contact « Karim Test », 3 leads dans des étapes différentes |

Pour changer le rôle d'un compte de test (SQL Editor Supabase) :

```sql
update public.organization_memberships m
set role = 'member'
from auth.users u
where u.id = m.profile_id and lower(u.email) = '<email du compte>';
```

Statuts à reporter dans la colonne **Résultat** : ✅ OK · ❌ KO · ⏭️ Non testé (préciser
la raison, par exemple « clé Groq absente »).

Préconditions communes : être connecté via **Sign in with Google**. Le contournement de
développement (« Dev Bypass ») affiche des données de démo et ne compte pas comme un test
valide.

---

## 1. Pipeline (`/dashboard/leads`, `/crm`)

| ID     | Cas de test                          | Préconditions                                         | Étapes                                                                                                         | Résultat attendu                                                                                                                                                                               | Résultat |
| ------ | ------------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| PIP-01 | Affichage du pipeline                | Compte A, 3 leads existants                           | Ouvrir **Pipeline** dans le menu                                                                               | Les colonnes d'étapes s'affichent (À contacter, Contacté, À relancer, Meeting fixé, Propale envoyée, Gagné…) avec le bon nombre de leads par colonne ; le compteur du menu correspond au total |          |
| PIP-02 | Créer un lead (formulaire)           | Compte A                                              | **Nouveau lead** → saisir entreprise « Test Atlas SA », contact, sujet, prochaine action et date → Enregistrer | Le lead apparaît dans la colonne choisie ; il est toujours présent après rechargement (F5)                                                                                                     |          |
| PIP-03 | Création avec date invalide          | Compte A                                              | Créer un lead avec une date de lead incohérente (ex. 31/02)                                                    | Message d'erreur, aucun lead créé                                                                                                                                                              |          |
| PIP-04 | Créer un lead en langage naturel     | Compte A, `GROQ_API_KEY` configurée                   | Raccourci IA : « J'ai parlé à Karim de Atlas Telecom pour un projet IA CRM, à relancer vendredi. »             | Les champs entreprise, contact, sujet et date de relance sont pré-remplis ; rien n'est enregistré sans validation                                                                              |          |
| PIP-05 | Changer d'étape par glisser-déposer  | Compte A                                              | Glisser un lead de « À contacter » vers « Contacté »                                                           | Le lead change de colonne, l'ordre est conservé après rechargement                                                                                                                             |          |
| PIP-06 | Réordonner dans une colonne          | Compte A, 2 leads dans la même colonne                | Glisser le 2ᵉ lead au-dessus du 1ᵉʳ                                                                            | Nouvel ordre conservé après rechargement                                                                                                                                                       |          |
| PIP-07 | Modifier un lead                     | Compte A                                              | Ouvrir un lead → modifier le sujet et la prochaine action → Enregistrer                                        | Modifications visibles dans la carte et la fiche                                                                                                                                               |          |
| PIP-08 | Marquer la prochaine action « Fait » | Compte A, lead avec action en retard                  | Cliquer **Fait** sur la carte                                                                                  | L'action passe à « faite », le lead sort de la section **Retards**                                                                                                                             |          |
| PIP-09 | Sections Retards / Cette semaine     | Compte A, un lead à date passée et un à J+2           | Ouvrir le pipeline                                                                                             | Le premier est listé dans **Retards**, le second dans **Cette semaine**                                                                                                                        |          |
| PIP-10 | Vues Kanban / Calendrier / Liste     | Compte A                                              | Basculer entre les 3 vues                                                                                      | Les mêmes leads apparaissent dans chaque vue                                                                                                                                                   |          |
| PIP-11 | Tags                                 | Compte A                                              | Créer le tag « Prioritaire » → l'ajouter à un lead → le renommer → le supprimer                                | Le tag suit chaque opération ; sa suppression le retire des leads                                                                                                                              |          |
| PIP-12 | Notes de lead                        | Compte A                                              | Ajouter une note → la modifier → la supprimer                                                                  | Historique des notes cohérent, avec auteur et date                                                                                                                                             |          |
| PIP-13 | Gérer les étapes (catégories)        | Compte A                                              | Paramètres pipeline : créer une étape, la renommer, changer sa couleur, la déplacer, la supprimer              | Les colonnes du pipeline reflètent chaque changement                                                                                                                                           |          |
| PIP-14 | Supprimer un lead                    | Compte A                                              | Supprimer un lead de test → confirmer                                                                          | Le lead disparaît de toutes les vues et des compteurs                                                                                                                                          |          |
| PIP-15 | Synchroniser avec Google Calendar    | Compte A connecté à Google, lead avec date de meeting | Action **Ajouter au calendrier** → valider                                                                     | Événement créé dans Google Calendar ; si le créneau est occupé, un autre créneau est proposé au lieu de créer un doublon                                                                       |          |
| PIP-16 | Rôle viewer en lecture seule         | Compte C                                              | Ouvrir le pipeline, tenter de créer/modifier un lead                                                           | Pipeline visible, création et modification refusées                                                                                                                                            |          |
| PIP-17 | Isolation entre organisations        | Deux organisations de test                            | Avec un compte de l'organisation 2, ouvrir le pipeline                                                         | Aucun lead de l'organisation 1 n'est visible                                                                                                                                                   |          |

## 2. Dossiers Drive (`/dashboard/drives`)

Préconditions spécifiques : `GOOGLE_SERVICE_ACCOUNT_KEY` et `MAYA_DRIVE_OUTPUT_FOLDER_ID`
configurés, compte de service membre du Drive partagé.

| ID     | Cas de test                  | Préconditions                     | Étapes                                             | Résultat attendu                                                                                                                                 | Résultat |
| ------ | ---------------------------- | --------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| DRV-01 | Liste des dossiers           | Compte A                          | Ouvrir **Dossiers Drive**                          | Les entreprises et leurs dossiers liés s'affichent ; le compteur du menu correspond                                                              |          |
| DRV-02 | Créer le dossier d'un client | Compte A, entreprise sans dossier | **Créer le dossier Drive**                         | Un dossier client est créé sous le dossier `clients` avec les sous-dossiers `01_Pitch` … `05_Delivery` ; le lien est enregistré sur l'entreprise |          |
| DRV-03 | Pas de doublon               | Compte A, entreprise avec dossier | Relancer la création                               | Aucun second dossier ; le lien existant est conservé                                                                                             |          |
| DRV-04 | Ouvrir le dossier            | Compte A                          | Cliquer sur le lien du dossier                     | Le dossier s'ouvre dans Google Drive                                                                                                             |          |
| DRV-05 | Lier un dossier existant     | Compte A                          | Coller une URL de dossier Drive sur une entreprise | Lien enregistré et affiché ; une URL invalide est refusée                                                                                        |          |
| DRV-06 | Configuration absente        | Variables Drive vides             | Tenter de créer un dossier                         | Message d'erreur clair, aucun plantage                                                                                                           |          |
| DRV-07 | Accès tous rôles             | Comptes B et C                    | Ouvrir `/dashboard/drives`                         | La page est accessible et apparaît dans le menu                                                                                                  |          |

## 3. Suivi des relances (`/dashboard/follow-ups`)

| ID     | Cas de test                   | Préconditions                        | Étapes                                                           | Résultat attendu                                                                                    | Résultat |
| ------ | ----------------------------- | ------------------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------- |
| REL-01 | Liste des relances            | Compte A, leads avec date de relance | Ouvrir **Suivi des relances**                                    | Les relances sont triées par date ; les retards sont mis en évidence                                |          |
| REL-02 | Enregistrer une relance       | Compte A                             | Sur un lead : **Ajouter une relance** (canal, date, commentaire) | La relance apparaît dans l'historique du lead et dans la liste                                      |          |
| REL-03 | Générer un brouillon WhatsApp | Compte A, `GROQ_API_KEY` configurée  | **Générer une relance** → canal WhatsApp                         | Un brouillon personnalisé (nom du contact, sujet) s'affiche ; **rien n'est envoyé** automatiquement |          |
| REL-04 | Générer un brouillon email    | Compte A, `GROQ_API_KEY` configurée  | **Générer une relance** → canal Email                            | Brouillon avec objet et corps ; aucun envoi sans action humaine                                     |          |
| REL-05 | Sans clé IA                   | `GROQ_API_KEY` vide                  | Générer une relance                                              | Message indiquant que l'IA n'est pas disponible, ou modèle de secours local ; pas d'erreur 500      |          |
| REL-06 | Relance terminée              | Compte A                             | Marquer l'action de relance comme faite                          | La relance sort de la liste « à faire »                                                             |          |

## 4. Tâches & prochaines actions (`/dashboard/todo`, `/dashboard/tasks`)

| ID     | Cas de test                | Préconditions                        | Étapes                                                                         | Résultat attendu                                                                                      | Résultat |
| ------ | -------------------------- | ------------------------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | -------- |
| TSK-01 | Liste des tâches           | Compte A                             | Ouvrir **Tâches**                                                              | Les tâches manuelles et les prochaines actions des leads s'affichent ; le compteur du menu correspond |          |
| TSK-02 | Créer une tâche manuelle   | Compte A                             | **Nouvelle tâche** : titre, description, échéance, lead lié, personne assignée | La tâche apparaît avec le statut `todo`                                                               |          |
| TSK-03 | Changer le statut          | Compte A                             | Passer une tâche `todo` → `in-progress` → `done`                               | Le statut est conservé après rechargement                                                             |          |
| TSK-04 | Modifier une tâche         | Compte A                             | Changer le titre et l'échéance                                                 | Modifications enregistrées                                                                            |          |
| TSK-05 | Supprimer une tâche        | Compte A                             | Supprimer une tâche de test                                                    | Elle disparaît de la liste et des compteurs                                                           |          |
| TSK-06 | Prochaine action d'un lead | Compte A, lead avec prochaine action | Marquer l'action « faite » depuis **Tâches**                                   | Le lead correspondant affiche aussi l'action comme faite dans le pipeline                             |          |
| TSK-07 | Assignation                | Comptes A et B                       | A assigne une tâche à B                                                        | B voit la tâche qui lui est assignée                                                                  |          |
| TSK-08 | Titre vide                 | Compte A                             | Créer une tâche sans titre                                                     | Création refusée avec un message                                                                      |          |

## 5. Fiches clients (`/dashboard/clients`, `/dashboard/clients/[id]`)

| ID     | Cas de test                     | Préconditions                   | Étapes                                                           | Résultat attendu                                                           | Résultat |
| ------ | ------------------------------- | ------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------- | -------- |
| CLI-01 | Liste des clients               | Compte A                        | Ouvrir **Clients**                                               | Les entreprises s'affichent ; le compteur du menu correspond               |          |
| CLI-02 | Créer une entreprise            | Compte A                        | **Nouvelle entreprise** → nom, secteur, site                     | La fiche est créée et accessible                                           |          |
| CLI-03 | Fiche détaillée                 | Compte A, entreprise avec leads | Ouvrir une fiche client                                          | Infos de l'entreprise, contacts, leads liés et dossier Drive sont affichés |          |
| CLI-04 | Modifier l'entreprise           | Compte A                        | Modifier le nom et le secteur                                    | Les changements apparaissent aussi sur les leads liés                      |          |
| CLI-05 | Ajouter un contact              | Compte A                        | Ajouter « Karim Test » avec email, téléphone, poste, LinkedIn    | Le contact apparaît sur la fiche                                           |          |
| CLI-06 | Modifier / supprimer un contact | Compte A                        | Modifier le poste puis supprimer le contact                      | Chaque opération est reflétée sur la fiche                                 |          |
| CLI-07 | Tags de contact                 | Compte A                        | Ajouter un tag à un contact                                      | Tag visible sur le contact                                                 |          |
| CLI-08 | Fiche inexistante               | Compte A                        | Ouvrir `/dashboard/clients/00000000-0000-0000-0000-000000000000` | Page « introuvable » propre, pas d'erreur serveur                          |          |

## 6. Meetings (`/meetings`, `/meetings/history`)

| ID     | Cas de test                     | Préconditions                                        | Étapes                                                                 | Résultat attendu                                                                                                    | Résultat |
| ------ | ------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------- |
| MTG-01 | Agenda du jour                  | Compte A connecté à Google, un événement aujourd'hui | Ouvrir **Meetings**                                                    | Les événements du jour (fuseau Africa/Casablanca) sont proposés dans le sélecteur                                   |          |
| MTG-02 | Nouveau meeting manuel          | Compte A                                             | **Nouveau meeting** → choisir un client                                | L'espace de prise de notes s'ouvre                                                                                  |          |
| MTG-03 | Prise de notes                  | MTG-02 fait                                          | Écrire des notes → quitter puis revenir                                | Le brouillon est conservé                                                                                           |          |
| MTG-04 | Enregistrement audio            | Navigateur avec micro autorisé                       | Démarrer la capture puis **Traiter**                                   | L'audio est envoyé, un traitement est mis en file d'attente                                                         |          |
| MTG-05 | Historique                      | Au moins un meeting traité                           | Ouvrir **Historique**                                                  | Les meetings traités sont listés du plus récent au plus ancien                                                      |          |
| MTG-06 | Relecture et approbation        | Compte-rendu prêt                                    | Modifier le compte-rendu → choisir les recommandations → **Approuver** | Compte-rendu approuvé ; les tâches de suivi retenues sont créées                                                    |          |
| MTG-07 | Relancer un traitement en échec | Traitement en échec                                  | **Réessayer**                                                          | Le traitement repart sans créer de doublon                                                                          |          |
| MTG-08 | Synchronisation Gemini          | Compte A, scope `drive.meet.readonly` accordé        | **Synchroniser Gemini**                                                | Les notes Gemini récentes sont importées sans doublon ; un second clic pendant la synchro indique « déjà en cours » |          |
| MTG-09 | Ask NAIA                        | Notes existantes                                     | Poser une question sur un meeting passé                                | Réponse avec les sources affichées                                                                                  |          |
| MTG-10 | Accès tous rôles                | Comptes B et C                                       | Ouvrir `/meetings` et `/meetings/history`                              | Pages accessibles, pas de message « réservé »                                                                       |          |
| MTG-11 | Sans session                    | Déconnecté                                           | Ouvrir `/meetings`                                                     | Redirection vers `/login`                                                                                           |          |

## 7. Docs Generator (`/proposals`)

Préconditions spécifiques : `MAYA_DRIVE_OUTPUT_FOLDER_ID`, `MAYA_PITCH_TEMPLATE_FILE_ID` et
`MAYA_PITCH_TEMPLATE_SHA256` configurés ; le lead a un dossier Drive client contenant `01_Pitch`.

| ID     | Cas de test                   | Préconditions                             | Étapes                                           | Résultat attendu                                                      | Résultat |
| ------ | ----------------------------- | ----------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------- | -------- |
| DOC-01 | File des pitchs               | Compte A, lead à l'étape « Meeting fixé » | Ouvrir **Docs Generator**                        | Le lead apparaît dans la file des pitchs à générer                    |          |
| DOC-02 | Confirmation obligatoire      | Compte A                                  | Lancer la génération sans cocher la confirmation | Génération refusée : « Confirme explicitement la copie du modèle… »   |          |
| DOC-03 | Générer un pitch              | Compte A                                  | Cocher la confirmation → **Générer**             | Un fichier PPTX est déposé dans `01_Pitch` du dossier client          |          |
| DOC-04 | Pas de doublon                | DOC-03 fait                               | Relancer la génération                           | Message « Le draft existe déjà dans 01_Pitch » ; aucun second fichier |          |
| DOC-05 | Dossier Drive manquant        | Lead sans dossier Drive                   | Tenter la génération                             | Refus clair ; aucun dossier n'est créé automatiquement                |          |
| DOC-06 | Modèle non vérifié            | `MAYA_PITCH_TEMPLATE_SHA256` vide ou faux | Tenter la génération                             | Refus (fail-closed), aucun fichier copié                              |          |
| DOC-07 | Accès tous rôles              | Comptes B et C                            | Ouvrir `/proposals` et lancer une génération     | Page visible dans le menu et génération autorisée                     |          |
| DOC-08 | Pas de génération automatique | Compte A                                  | Passer un lead en « Meeting fixé »               | Aucun pitch créé tant que personne ne lance la génération             |          |

## 8. Accès et sécurité (transverse)

| ID     | Cas de test         | Préconditions                                              | Étapes                                                                       | Résultat attendu                       | Résultat |
| ------ | ------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------- | -------- |
| SEC-01 | Pages protégées     | Déconnecté, `npm run build && npm start` (mode production) | Ouvrir `/dashboard`, `/crm`, `/meetings`, `/proposals`                       | Redirection vers `/login` pour chacune |          |
| SEC-02 | Email non autorisé  | Compte Google absent de `AUTH_ALLOWED_EMAILS`              | Se connecter                                                                 | Accès refusé, retour à `/login`        |          |
| SEC-03 | RLS côté base       | Clé publique Supabase, sans session                        | Appeler `GET /rest/v1/crm_leads`                                             | Résultat vide : aucune donnée exposée  |          |
| SEC-04 | Secrets côté client | App ouverte                                                | Rechercher `sb_secret` et `GOCSPX` dans le code source de la page (DevTools) | Aucune occurrence                      |          |

---

## Synthèse de la campagne

| Module             | Total  | ✅  | ❌  | ⏭️  |
| ------------------ | ------ | --- | --- | --- |
| Pipeline           | 17     |     |     |     |
| Dossiers Drive     | 7      |     |     |     |
| Suivi des relances | 6      |     |     |     |
| Tâches             | 8      |     |     |     |
| Fiches clients     | 8      |     |     |     |
| Meetings           | 11     |     |     |     |
| Docs Generator     | 8      |     |     |     |
| Accès et sécurité  | 4      |     |     |     |
| **Total**          | **69** |     |     |     |

Testeur : ________ · Date : ________ · Version (commit) : ________

---

## Campagne n°1 — 03/11/2026 (exécution automatisée partielle)

Exécutée par Claude Code dans Chrome, compte `owner` connecté via Google, données
réelles Supabase (`CRM_DUMMY_DATA=disabled`), branche `feat/open-meetings-docs-access`.
Seuls les cas listés ci-dessous ont été exécutés ; tous les autres restent à faire.

| ID     | Résultat | Observation                                                                                                                                                                                                           |
| ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PIP-01 | ✅       | Pipeline vide affiché avec 7 colonnes par défaut. La base ne contient aucune étape : les colonnes viennent du code. Avec `CRM_DUMMY_DATA` non défini, le mode dev affiche des leads de démo dès que la base est vide. |
| PIP-02 | ✅ ⚠️    | Lead créé et conservé. Remarque UX : avec une « Date planifiée », le statut « À contacter » est forcé en « Meeting fixé » (règle volontaire de `resolveLeadInsertStatus`), sans que le formulaire l'indique.          |
| PIP-05 | ✅       | Changement d'étape via le bouton **Avancer** (Meeting fixé → Propale envoyée), conservé après rechargement. Le glisser-déposer n'a pas pu être simulé par l'outil d'automatisation : à tester à la main.              |
| PIP-08 | ✅       | **Fait** passe `next_action_state` à `done` et la tâche liée à `done`. Avancer une étape remplace la prochaine action par une action automatique (« Maya : préparer la propale… »).                                   |
| PIP-09 | ✅       | Lead à J+2 listé dans **Cette semaine**, retiré une fois l'action faite.                                                                                                                                              |
| PIP-10 | ✅       | Vues Kanban, Calendrier (lead au 5 nov.) et Liste (filtres statut/entreprise) cohérentes.                                                                                                                             |
| TSK-01 | ✅       | Page Tâches affiche le lead ; compteurs du menu corrects après rechargement.                                                                                                                                          |
| TSK-06 | ✅ ⚠️    | État cohérent en base. Remarque UX : le tableau Tâches range les cartes par **statut du lead** (Propale envoyée → « En cours »), pas par état de l'action, donc une action faite reste en « En cours ».               |
| REL-01 | ✅       | Le lead apparaît avec sa prochaine action et la date du 05/11/2026 ; « Dernier contact : Jamais ».                                                                                                                    |
| DRV-01 | ✅       | Page accessible, 0 dossier (aucun dossier créé, compte de service non configuré).                                                                                                                                     |
| CLI-01 | ✅       | Entreprise créée automatiquement avec le lead (1 contact, 1 projet).                                                                                                                                                  |
| CLI-03 | ✅       | Fiche : informations, contact (poste, email), projet lié avec statut et prochaine action.                                                                                                                             |
| CLI-08 | ✅       | « Client introuvable » avec bouton Retour.                                                                                                                                                                            |
| MTG-01 | ✅       | Agenda Google lu : « Aucun meeting Calendar aujourd'hui », bouton **Nouveau meeting** disponible.                                                                                                                     |
| MTG-05 | ✅       | Historique vide : « Aucun meeting à suivre ».                                                                                                                                                                         |
| DOC-01 | ✅       | File vide : aucun lead en « Meeting fixé » au moment du test.                                                                                                                                                         |
| DOC-06 | ✅       | Refus clair : « Le Drive privé Maya n'est pas entièrement configuré ».                                                                                                                                                |
| SEC-03 | ✅       | Sans session, l'API renvoie `[]` sur `crm_leads`, `crm_companies`, `meetings`, `profiles`, et refuse `integration_connections`.                                                                                       |
| SEC-04 | ✅       | Aucun des deux secrets dans les fichiers JS envoyés au navigateur (`.next/static`) ; seule la clé publique y figure.                                                                                                  |

**Bilan : 19 cas exécutés, 19 ✅ (dont 2 avec remarque UX), 0 ❌, 50 restants.**

Restent à faire à la main ou après configuration :

- **Clé `GROQ_API_KEY`** : PIP-04, REL-03, REL-04.
- **Compte de service Drive** (`GOOGLE_SERVICE_ACCOUNT_KEY`, `MAYA_DRIVE_OUTPUT_FOLDER_ID`) : DRV-02 à DRV-05.
- **Modèle de pitch** (`MAYA_PITCH_TEMPLATE_FILE_ID`, `MAYA_PITCH_TEMPLATE_SHA256`) : DOC-03, DOC-04.
- **Micro et vrai meeting** : MTG-02 à MTG-09.
- **Autres comptes Google (member, viewer)** : PIP-16, DRV-07, TSK-07, MTG-10, DOC-07.
- **Glisser-déposer** : PIP-05 (variante souris), PIP-06.
