# Brief quotidien NAIA

Le brief quotidien regroupe les échéances CRM, les événements du calendrier
Google principal et un triage prudent des messages récents de la boîte de
réception. Il est envoyé à 09:30, heure de Casablanca, dans un message Slack
privé et, une fois le template Meta approuvé et le canal activé, sur WhatsApp.
Les deux rendus partagent les mêmes données et les mêmes quatre sections. Le
rendu WhatsApp est condensé pour respecter la limite du template. Le workflow
ne modifie aucune donnée CRM, Calendar ou Gmail et n'envoie aucun email.

## Accès et confidentialité

- Les destinataires configurés doivent être des cofondateurs `owner` dont
  l'adresse est explicitement autorisée (`ali@qarizmi.com` ou
  `nabil@qarizmi.com`). Une autre adresse est refusée même si elle appartient à
  l'organisation.
- Slack est résolu par `users.lookupByEmail`, puis le message est envoyé dans le
  DM de ce compte. Les contenus externes sont neutralisés avant le rendu Block
  Kit pour empêcher les mentions collectives et le balisage injecté.
- WhatsApp est résolu dans le sens email vers numéro à partir du même
  `WHATSAPP_USER_MAP` qui autorise les commandes entrantes. Une adresse liée à
  zéro ou plusieurs numéros est refusée sans exposer le numéro dans les logs.
- La route cron ne renvoie que des compteurs agrégés. Elle exige
  `Authorization: Bearer $CRON_SECRET` et ne charge aucune donnée en cas
  d'échec d'authentification.
- `naia_daily_brief_runs` est accessible uniquement au rôle de service. Sa
  contrainte unique par profil, date locale et canal empêche un double envoi
  tout en isolant Slack de WhatsApp. Un échec prouvé avant acceptation par le
  fournisseur peut être réclamé transactionnellement ; une livraison réseau
  ambiguë reste verrouillée en `delivery_uncertain` et n'est jamais rejouée
  automatiquement.

## Horaire et variables

Vercel Cron fonctionne en UTC. Le projet appelle donc la route à 08:30 et
09:30 UTC ; la route n'exécute le brief que lorsque l'heure locale
`Africa/Casablanca` est comprise entre 09:30 et 09:44. Cela couvre les deux
décalages UTC utilisés au Maroc sans envoyer deux messages.

Variables serveur requises :

```text
CRON_SECRET=<secret aléatoire>
NAIA_DAILY_BRIEF_RECIPIENTS=ali@qarizmi.com
NAIA_DAILY_BRIEF_TIME_ZONE=Africa/Casablanca
NAIA_DAILY_BRIEF_CHANNELS=slack
WHATSAPP_DAILY_BRIEF_TEMPLATE_NAME=naia_daily_brief
WHATSAPP_DAILY_BRIEF_TEMPLATE_LANGUAGE=fr
```

Le bot Slack requiert `chat:write`, `users:read` et `users:read.email`. Chaque
destinataire doit avoir connecté son propre compte Google Workspace dans NAIA.

## Template WhatsApp obligatoire

Un message planifié à 09:30 est initié par l'entreprise et doit donc utiliser
un template Meta approuvé, même si NAIA peut répondre en texte libre dans la
fenêtre de service ouverte par une commande entrante. Créer un template
**Utility** nommé `naia_daily_brief`, langue **French (`fr`)**, avec ce corps et
exactement six variables :

```text
Bonjour {{1}}, voici ton briefing NAIA du {{2}}.

Urgent et important
{{3}}

Aujourd'hui
{{4}}

Vue de la semaine
{{5}}

Mails à traiter
{{6}}

Aucune action automatique n'a été effectuée.
```

Laisser `NAIA_DAILY_BRIEF_CHANNELS=slack` tant que le template n'est pas
approuvé. Après approbation et validation des coûts Meta, passer la variable à
`slack,whatsapp` puis redéployer. Le cron et l'heure restent identiques.

## Séquençage obligatoire de mise en production

Le cron ne doit pas être activé avant ses dépendances. L'ordre de déploiement
est volontairement explicite :

1. appliquer les migrations
   `supabase/migrations/20260809221355_naia_daily_brief_runs.sql`,
   `20260810023409_daily_brief_reliability.sql` et
   `20260812123107_naia_daily_brief_multichannel.sql` sur le projet Supabase de
   production ;
2. vérifier que la table et la fonction RPC
   `reclaim_naia_daily_brief_run` existent, que RLS est activé et que seul
   `service_role` possède les droits requis ;
3. créer `CRON_SECRET` dans l'environnement **Production** Vercel, puis définir
   les destinataires et le fuseau si les valeurs par défaut ne conviennent pas ;
4. créer et faire approuver le template Meta avant d'activer le canal WhatsApp ;
5. seulement ensuite déployer `vercel.json` en production et vérifier que le
   cron est enregistré.

Une Preview verte ne crée pas le cron : Vercel Cron ne s'exécute qu'en
production. Ne pas déclencher manuellement la route avec les vrais comptes pour
un test d'envoi sans accord explicite, car cela produit un DM Slack réel et,
si activé, un message template WhatsApp potentiellement facturé par Meta.

## Interprétation Gmail

Le bloc « Mails non lus à vérifier » est un triage de l'Inbox des trente
derniers jours, hors promotions, réseaux sociaux et forums. Il n'affirme pas
qu'un message lu attend une réponse : cette classification nécessiterait une
analyse complète et auditable du fil. NAIA n'envoie jamais de réponse depuis
ce workflow.
