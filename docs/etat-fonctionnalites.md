# État des fonctionnalités — NAIA-os

Audit du 03/11/2026 sur l'environnement local (`npm run dev`, Supabase
`etgxhfsantjhughrcewr`, compte `owner` connecté via Google).

## Résumé

- **30 pages** : toutes répondent `200`, aucune page d'erreur, aucun log d'erreur serveur.
- **Routes API protégées** (cron, WhatsApp, Slack, worker meetings) : refusent bien les
  appels non authentifiés (`401`/`403`).
- **Assistant NAIA** : répond en mode local (sans IA externe) à partir des données CRM.
- **Qualité** : lint, typecheck et build OK ; 999/1004 tests unitaires OK (5 échecs liés
  à Windows, sans impact fonctionnel).

## Fonctionnalités par état

| Fonctionnalité                                   | État                                       | Ce qu'il manque                                                                                                             |
| ------------------------------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Connexion Google (OAuth)                         | ✅ Fonctionne                              | —                                                                                                                           |
| Pipeline (création, étapes, vues, « Fait »)      | ✅ Fonctionne                              | —                                                                                                                           |
| Fiches clients et contacts                       | ✅ Fonctionne                              | —                                                                                                                           |
| Tâches et suivi des relances                     | ✅ Fonctionne                              | —                                                                                                                           |
| Notifications                                    | ✅ Fonctionne                              | —                                                                                                                           |
| Google Calendar (agenda du jour, sync des leads) | ✅ Fonctionne                              | —                                                                                                                           |
| Assistant NAIA (chat texte)                      | ✅ Fonctionne (Groq)                       | Corrigé : ne mélange plus le pipeline simulé avec le CRM réel                                                               |
| Saisie de lead en langage naturel                | ✅ Fonctionne (Groq)                       | Le poste et la date de relance ne sont pas toujours extraits                                                                |
| Brouillons de relance WhatsApp/Email             | ✅ Fonctionne (Groq)                       | Visibles seulement depuis la fiche du lead (voir point 6)                                                                   |
| Dictée vocale et création de lead par la voix    | ✅ Fonctionne (Groq Whisper)               | —                                                                                                                           |
| Voix de NAIA                                     | ✅ Fonctionne (ElevenLabs, voix « Sarah ») | Plan gratuit : seules les voix par défaut sont utilisables par l’API                                                        |
| Dossiers Drive clients                           | ✅ Fonctionne                              | Dossier `NAIA - Clients` partagé avec le compte de service `naia-drive`                                                     |
| Docs Generator (pitch Maya)                      | ❌ Inactif                                 | Drive ci-dessus + `MAYA_DRIVE_SOURCE_FOLDER_ID`, `MAYA_PITCH_TEMPLATE_FILE_ID`, `MAYA_PITCH_TEMPLATE_SHA256`                |
| Meetings : prise de notes                        | ✅ Fonctionne                              | —                                                                                                                           |
| Meetings : transcription et compte rendu         | ❌ Inactif                                 | Application compagnon + `MEETING_NOTES_COMPANION_TOKEN`                                                                     |
| Meetings : synchro Gemini                        | ⚠️ À tester                                | Scope `drive.meet.readonly` accordé par l'utilisateur                                                                       |
| Brief quotidien NAIA                             | ❌ Inactif                                 | `CRON_SECRET`, `NAIA_DAILY_BRIEF_RECIPIENTS`, `NAIA_DAILY_BRIEF_CHANNELS`, `NAIA_DAILY_BRIEF_TIME_ZONE` + Slack ou WhatsApp |
| Bot Slack                                        | ❌ Inactif                                 | `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` + URL publique                                                                    |
| Bot WhatsApp                                     | ❌ Inactif                                 | 6 variables `WHATSAPP_*` + compte Meta Business + URL publique                                                              |
| Projects, HR, Finance, Automations               | ⏳ Non développés                          | Modules marqués « Bientôt » (pages vitrines)                                                                                |

## Points d'attention

1. **Jeton Google valable 7 jours** : tant que l'écran de consentement Google est en mode
   _Testing_, Google expire le refresh token au bout de 7 jours. Il faudra se reconnecter
   chaque semaine, ou publier l'application (validation Google requise pour
   `gmail.readonly`).
2. **Secrets exposés dans la conversation** : la clé secrète Supabase et le secret client
   Google ont été partagés en clair ; à régénérer avant toute démo publique.
3. **Rôles** : l'accès en production reste limité à `ali@` et `nabil@qarizmi.com`
   (`src/platform/auth/access.ts`) ; à adapter avant un déploiement Vercel du PFA.
4. **Étapes du pipeline** : aucune étape n'est créée en base à l'installation ; les
   7 colonnes affichées viennent du code.
5. **Webhooks** (Slack, WhatsApp, cron) : nécessitent une URL publique HTTPS (déploiement
   Vercel ou tunnel type ngrok), impossible à tester sur `localhost` seul.
6. **Bouton « Relance IA » sur la carte du pipeline** : il génère les brouillons mais ne
   les affiche que si la fiche du lead est ouverte
   (`src/app/(app)/dashboard/leads/crm-pipeline-client.tsx`). Utiliser le bouton
   « Relance IA » de la fiche (section « Actions avancées »).
7. **Modèle Groq par défaut retiré** : `qwen/qwen3.6-27b` n'existe plus chez Groq.
   `.env.local` force `GROQ_ORCHESTRATOR_MODEL=openai/gpt-oss-120b` ; à reporter dans
   `src/platform/ai/groq.ts` (et sur Vercel) pour un déploiement.

## Mise à jour — clé Groq ajoutée

Après ajout de `GROQ_API_KEY` (validée auprès de l'API Groq) :

- NAIA répond en mode `groq-orchestrated` avec le seul lead réel « Test Atlas SA ».
  Avant correction, l'IA ajoutait des leads fictifs (« Atlas Process », « Argan Retail »,
  « Medina Health ») issus des données simulées Finance/Projects/HR ; le pipeline simulé
  n'est plus envoyé au modèle (`src/platform/naia/assistant.ts`).
- Saisie en langage naturel : entreprise, contact, email, source et action suivante remplis.
- Brouillons de relance : email et WhatsApp personnalisés, avec liens « Ouvrir dans
  Gmail / WhatsApp » ; aucun envoi automatique.
- Synchronisation Google Calendar d'un lead confirmée (identifiant d'événement enregistré
  dans les notes du lead).

## Mise à jour — compte de service Drive configuré

- `GOOGLE_SERVICE_ACCOUNT_KEY` (compte `naia-drive`) et `MAYA_DRIVE_OUTPUT_FOLDER_ID`
  (dossier « NAIA - Clients ») ajoutés ; accès en écriture vérifié auprès de Google.
- Création du dossier « Test Atlas SA » avec les sous-dossiers `01_Pitch` à `05_Delivery` ;
  lien enregistré sur le lead et l'entreprise ; page « Dossiers Drive » à jour (DRV-01 à DRV-04 ✅).
- Remarque UX : après la création, une fenêtre de lead vide s'ouvre ; la fermer sans
  enregistrer (les données du lead ne sont pas modifiées).

## Mise à jour — voix (ElevenLabs et Groq Whisper)

- `ELEVENLABS_API_KEY` ajoutée ; `ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL` (voix par défaut
  « Sarah »). Le plan gratuit refuse les voix de la bibliothèque (erreur 402) ; la clé n'a pas
  la permission « Voices (Read) », ce que l'app gère en retombant sur la voix configurée.
- **Bug corrigé** : la fonction SQL `consume_external_ai_daily_quota` n'autorisait que
  `ali@` et `nabil@qarizmi.com`, ce qui bloquait la voix de NAIA, la dictée et la création
  de lead par la voix (`503 external-ai-quota-unavailable`). La migration
  `20261103150000_external_ai_quota_for_owner_admin_roles.sql` l'ouvre aux rôles
  `owner` et `admin`, comme la vérification côté application. Le quota quotidien est conservé.
- Tests : synthèse vocale `200 audio/mpeg` ; transcription via `/api/crm/transcribe` `200`
  avec le texte attendu.
