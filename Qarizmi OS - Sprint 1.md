## **Stack recommandé**

**MVP simple :**

- **Next.js App Router** pour l’app web/admin
- **Supabase** pour DB + auth + storage + edge functions
- # **Trello API** pour synchroniser vos leads existants - remplacer la parti trello par un CRM local
- **OpenAI Responses API / Agents SDK** pour les workflows IA
- **Google Drive + Gmail API** ensuite
- **Vercel** pour déployer vite

Next.js App Router est le standard actuel côté full-stack React, Supabase couvre DB/auth/functions, et Trello a une REST API exploitable pour lire/créer/modifier cards/lists.  

------

# **Mission Hamza cette semaine**

## **Objectif concret**

Construire le **Qarizmi OS v0.1 = mini CRM + agent lead intake**.

------

# **Priorité 1 — Import Trello → Supabase**

Connecter le board Trello actuel et importer :

- cards
- lists
- labels
- due dates
- comments
- links
- attachments si possible

Modèle DB minimal :

```text
companies
contacts
leads
lead_events
tasks
documents
```

Chaque Trello card devient un `lead`.

------

# **Priorité 2 — Interface mini CRM**

Une page web simple :

```text
Leads à contacter
Contactés
À relancer
Meeting booked
Propales envoyées
Dead ends
```

Avec fiche lead :

- company
- contact name
- phone
- email
- source
- status: {'lead à contacter', 'déjà contacté', 'meeting booked', 'propale envoyée'}
- next action
- notes
- #Trello link not needed

------

# **Priorité 3 — Agent “Add Lead”**

Un formulaire/chat interne :

```text
J’ai parlé à Achraf Hakimi d’Afriquia, potentiel sujet IA service client, à relancer vendredi.
```

L’agent extrait :

```json
{
  "company": "Afriquia",
  "contact": "Achraf Hakimi",
  "status": "à relancer",
  "topic": "IA service client",
  "next_action_date": "vendredi"
}
```

Puis crée :

- lead dans Supabase
- #card Trello dans la bonne colonne => affichage du lead dans le dashboard du CRM

------

# **Priorité 4 — Agent “Follow-up”**

Bouton :

```text
Generate follow-up -> whatsapp or email
```

L’agent génère :

- email court
- message WhatsApp
- prochaine action

Pas d’envoi automatique au début. Juste brouillon. Agent génère le draft et human clique pour valider l'envoi avec un seul bouton

------

# **Priorité 5 — Google Drive folder creator**

Bouton :

```text
Create client folder
```

Structure :

```text
Client - Company Name
  01_Pitch
  02_Meeting Notes
  03_Proposal
  04_Contract
  05_Delivery
```

Puis sauvegarde le lien Drive dans le CRM.

------

# **Planning semaine Hamza**

## **Lundi**

Setup repo + stack.

Livrable :

```text
Next.js app deployed
Supabase project created
DB schema v0
.env configured
```

------

## **Mardi**

Trello sync.

Livrable :

```text
Import all existing Trello leads into Supabase
```

------

## **Mercredi**

Mini CRM UI.

Livrable :

```text
Lead board + lead detail page
```

------

## **Jeudi**

Agent add lead.

Livrable :

```text
Chat/form → structured lead → Supabase + Trello card
```

------

## **Vendredi**

Follow-up generator + demo.

Livrable :

```text
Generate WhatsApp/email follow-up for any lead
```

------

# **Pas pour cette semaine / focus later**

Pas de :

- multi-agent complexe
- LangGraph
- HR
- accounting
- proposal generator
- Slack
- Microsoft
- gros backend custom
- design parfait

------

# **Définition du succès vendredi**

```text
1. Tous les leads Trello sont dans Qarizmi OS
2. Tu ajoutes un lead en langage naturel
3. Il apparaît dans Supabase + Trello
4. Tu cliques sur un lead
5. Il génère une relance WhatsApp/email
6. Il crée le dossier Drive client
```

