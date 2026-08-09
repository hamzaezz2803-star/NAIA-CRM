# Brief quotidien NAIA

Le brief quotidien regroupe les échéances CRM, les événements du calendrier
Google principal et un triage prudent des messages récents de la boîte de
réception. Il est envoyé à 09:30, heure de Casablanca, dans un message Slack
privé. Il ne modifie aucune donnée CRM, Calendar ou Gmail et n'envoie aucun
email.

## Accès et confidentialité

- Les destinataires configurés doivent être des cofondateurs `owner` dont
  l'adresse est explicitement autorisée (`ali@qarizmi.com` ou
  `nabil@qarizmi.com`). Une autre adresse est refusée même si elle appartient à
  l'organisation.
- Slack est résolu par `users.lookupByEmail`, puis le message est envoyé dans le
  DM de ce compte. Les contenus externes sont neutralisés avant le rendu Block
  Kit pour empêcher les mentions collectives et le balisage injecté.
- La route cron ne renvoie que des compteurs agrégés. Elle exige
  `Authorization: Bearer $CRON_SECRET` et ne charge aucune donnée en cas
  d'échec d'authentification.
- `naia_daily_brief_runs` est accessible uniquement au rôle de service. Sa
  contrainte unique par profil et date locale empêche un double envoi.

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
```

Le bot Slack requiert `chat:write`, `users:read` et `users:read.email`. Chaque
destinataire doit avoir connecté son propre compte Google Workspace dans NAIA.

## Interprétation Gmail

Le bloc « Mails non lus à vérifier » est un triage de l'Inbox des trente
derniers jours, hors promotions, réseaux sociaux et forums. Il n'affirme pas
qu'un message lu attend une réponse : cette classification nécessiterait une
analyse complète et auditable du fil. NAIA n'envoie jamais de réponse depuis
ce workflow.
