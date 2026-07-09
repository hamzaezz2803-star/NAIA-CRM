# Handoff : Refonte NAIA-os — Projets, RH, Finance (+ CRM Pipeline)

## Overview

Refonte visuelle de la plateforme interne **NAIA-os** (repo `nabil-qarizmi/qarizmi-os-design`, Next.js App Router + Tailwind). La direction retenue est un **hybride sombre** : structure "Maison" (en-tête éditorial serif + grande carte tableau) × palette "Cockpit" (navy nuit + teal Qarizmi). Trois modules sont spécifiés en détail — **Projets** (control tower delivery), **RH** (plan de recrutement) et **Finance** (cockpit cash) — plus trois directions explorées pour le **CRM Pipeline**.

## About the Design Files

Les fichiers de ce bundle sont des **références de design créées en HTML** — des prototypes montrant le rendu et le comportement attendus, PAS du code de production à copier. La tâche est de **recréer ces designs dans le codebase existant** (`qarizmi-os-design` : Next.js 15 App Router, Tailwind CSS, composants type shadcn/ui, `next-themes`, lucide-react) en suivant ses patterns établis : pages sous `src/app/(app)/…`, registre de modules `src/platform/core/modules.ts`, tokens dans `src/app/globals.css`, composants UI sous `src/components/ui/`.

Le fichier `CRM Pipeline Redesign.dc.html` est un document d'exploration : chaque option y est identifiée par un badge (1a, 1b, 1c, 2a, 2b, 2c, 3a, 3b, 3c). **La direction à implémenter est la série 3** (3a Projets, 3b RH, 3c Finance). Les tours 1 et 2 sont des explorations conservées pour contexte.

## Fidelity

**High-fidelity (hifi).** Couleurs, typos, espacements et états sont définitifs — recréer pixel-perfect avec les libs du codebase (Tailwind + lucide-react). Les données affichées sont des données de seed réalistes (issues de `src/features/naia/operating-data.ts` et du seed CRM) ; brancher les vraies sources.

## Design Tokens (thème sombre hybride)

### Couleurs — surfaces

- Fond page : `#0A141F`
- Sidebar : `#0C1826` · bordure `#17293A`
- Carte : `#0E1B29` · bordure `#182B3C`
- Header/footer de carte, bandes : `#0C1824` (ligne "vue globale" : `#0D1B2A`)
- Hover de ligne / carte imbriquée : `#112130` · séparateurs internes `#13212F`
- Éléments de saisie / segmented controls : fond `#0E1B29`, bordure `#1D3144`, segment actif `#1C3145`
- Bordure désactivée / chip off : `#24384C`

### Couleurs — texte

- Primaire : `#E9F0F6` (titres page : `#F2F6FA`)
- Secondaire : `#B6C6D4` (labels de section), `#8AA0B4` (corps)
- Atténué : `#6B8195`, `#54697D` · très faible : `#41576B`, `#5C7286`

### Couleurs — accent & statuts

- **Teal Qarizmi (accent)** : `#2FD6C3` · hover `#5CE0D0` · texte sur accent `#06231F` · teal clair `#7FD9CD` · fonds actifs `rgba(47,214,195,0.06–0.10)` · bordure active `rgba(47,214,195,0.3–0.45)`
- Vert (OK / encaissements) : `#34D399` (fond badge `rgba(52,211,153,0.10)`)
- Ambre (à surveiller) : `#FBBF24` (fond `rgba(251,191,36,0.10)`, barre gantt `rgba(251,191,36,0.16)`)
- Rouge (risque / retard / décaissements) : `#F87171` (fond `rgba(248,113,113,0.10)`, barre `rgba(248,113,113,0.14)`)
- Barres décaissements (chart) : `#55708C`
- Avatar : fond `#1C3145`, texte `#7FD9CD`

### Typographie

- **Playfair Display** (serif) : titres de page 27px/600 ; wordmark sidebar "Qarizmi" 15px italic
- **Geist** (sans) : corps ; nav sidebar 12.5px/500 (actif 600) ; noms 12–12.5px/600 ; descriptions 10.5–11px
- **Geist Mono** : tous les chiffres (KPIs 17px/600, stats inline 11px, pourcentages 9.5px), raccourcis ⌘K
- Labels de colonnes / eyebrows : 9–10.5px, weight 600, `letter-spacing: 0.08–0.1em`, MAJUSCULES
- Eyebrow de page (ex. "PROJETS") : 10.5px/600, teal `#2FD6C3`, `letter-spacing: 0.1em`

### Rayons, espacements, icônes

- Rayons : cartes 12px · sous-cartes/inputs 8–10px · segments 5–6px · badges/pills 99px
- Sidebar 236px · top bar 52px · padding page 24px · gap entre cartes 10px
- Icônes : **lucide** 13–15px (nav), 11–13px (boutons) ; icône active teal, inactives `#54697D`

## Screens / Views

### 1. Shell commun (sidebar + top bar) — toutes les pages

- **Sidebar 236px**, fond `#0C1826` : logo NAIA-os (tuile blanche 34px, radius 9px, PNG `naia-os-q.png` 24px) + "NAIA-os" 13.5px/700 `#E9F0F6` + "Plateforme interne" 10.5px `#5C7286` ; items nav 12.5px avec icônes lucide (layout-dashboard, sparkles, handshake, calendar-days, file-text, briefcase-business, users, circle-dollar-sign, bot, plug-zap, settings) ; **item actif** : fond `rgba(47,214,195,0.08)`, texte `#E9F0F6` 600, icône teal ; badge "BÊTA" sur NAIA (pill 9px, teal, bordure `rgba(47,214,195,0.3)`) ; footer : wordmark "Qarizmi" Playfair italic + "AI · DATA · STRATEGY" 9.5px `letter-spacing:0.14em`.
- **Top bar 52px**, fond `rgba(12,24,38,0.7)`, bordure basse `#17293A` : "QARIZMI · ESPACE INTERNE" 11px `letter-spacing:0.08em` `#54697D` ; à droite : cloche avec point teal 6px, toggle thème (sun), avatar 26px + nom/rôle.
- **En-tête de page** : eyebrow teal MAJUSCULES → titre Playfair 27px → stats inline 11.5px `#6B8195` (alerte colorée, ex. "2 à risque élevé" en `#F87171`) ; à droite : recherche (input 34px), filtres, **bouton primaire teal** (fond `#2FD6C3`, texte `#06231F` 12px/700, radius 8px, hover `#5CE0D0`).

### 2. Projets — `/projects` (option 3a)

**Purpose** : control tower delivery — tous les projets de l'entreprise sur une timeline commune, groupés par client.

- **Carte unique** (fond `#0E1B29`, radius 12px) en tableau : colonnes `190px (ENTREPRISE) | 140px (PROJET) | 1fr (gantt 5 mois JUIL.→NOV.) | 200px (RISQUE · BLOCAGE)`, gap 14px, padding lignes 13px 18px.
- **Ligne "vue globale"** (gantt global entreprise) : fond `#0D1B2A` — "Qarizmi — vue globale" `#7FD9CD` + "5 projets actifs" + 5 cellules (une par mois, height 20px, radius 5px) fond teal d'intensité croissante avec la charge (`rgba(47,214,195,0.12/0.20/0.34)`) et le **nombre de projets actifs** en Geist Mono ; note "Charge : pic à 4 projets dès septembre".
- **Lignes projet, groupées par client** : le nom d'entreprise (12.5px/600) n'apparaît que sur la 1re ligne du groupe avec meta "N projets" ; lignes suivantes du même client : cellule entreprise vide, séparateur `1px dashed #142433` (entre groupes : `1px solid #182B3C`). Colonne projet : nom 11.5px `#B6C6D4` + % progression en mono dessous.
- **Barre gantt** : piste 30px avec graduations mensuelles (`repeating-linear-gradient`, trait `#13212F` tous les 20%) ; barre pill 20px positionnée `left/width` en % du semestre, fond teinté du statut, **remplissage plein = progression** ; drapeau ⚑ au mois de glissement possible, couleur du statut.
- **Risque** : badge pill (10px/600, fond translucide statut) "À surveiller · Août" / "Risque élevé · Sept." / "Maîtrisé · Nov." + blocage en 10.5px `#8AA0B4` dessous.
- **Footer légende** : Maîtrisé `#34D399` · À surveiller `#FBBF24` · Risque élevé `#F87171` + "⚑ mois où la livraison peut glisser · barre pleine = progression · lignes groupées par client".
- Données seed : Atlas Process Industries (Finance OS 68% ambre juil–sept ⚑août ; Portail fournisseurs 12% vert oct–nov), Medina Health Services (RH copilot 41% rouge août–nov ⚑sept), Sahara Logistics Group (Delivery cockpit 52% rouge juil–nov ⚑oct), Argan Retail Holding (CRM automation 24% ambre sept–nov ⚑sept).

### 3. RH — `/hr` (option 3b)

**Purpose** : plan de recrutement dérivé des projets signés au CRM.

- Même carte tableau : colonnes `250px (POSTE · RAISON) | 1fr (timeline 5 mois) | 230px (AVANCEMENT)`.
- Colonne poste : nom 12.5px/600 + **badge ETP** teal (pill 9px, fond `rgba(47,214,195,0.10)`) + raison 10.5px `#8AA0B4`.
- Timeline : même piste graduée ; **fenêtre d'arrivée** = pill 20% de largeur, fond `rgba(47,214,195,0.16)`, bordure `rgba(47,214,195,0.45)`, nom du mois centré 9px `#7FD9CD`.
- Avancement : 4 étapes **Annonce → Test → Entretiens → Offre**, chacune point 6px + label 9px ; états : fait = teal `#2FD6C3`, en cours = ambre `#FBBF24`, à venir = `#24384C`/texte `#54697D` ; statut libre dessous (ex. "Entretiens en cours").
- Footer : légende Fait/En cours/À venir + "Besoins calculés depuis les projets signés au CRM".
- Données : AI Delivery Lead (1 ETP, juillet, entretiens) · Full-stack Next.js (2 ETP, août, test) · Automation QA (0,5 ETP, septembre, annonce).

### 4. Finance — `/finance` (option 3c)

**Purpose** : cockpit cash — prévision 5 mois, détail du mois, plans de paiement.

- **Header** : segmented 30j/90j/180j (90j actif), bouton "Exporter", bouton primaire "Nouvelle facture".
- **Rangée KPI (4 cartes)** : label 9px MAJ + point statut 5px, valeur 17px Geist Mono 600, note 10px. Valeurs seed : Solde projeté fin juil. 610 000 MAD (creux août 480 000) · Encaissements juil. 420 000 · Décaissements juil. 310 000 · Prochain encaissement 168 000 (Atlas Process · 15/07).
- **Chart flux (2/3 largeur)** : 5 mois, 2 barres/mois (encaissements `#2FD6C3`, décaissements `#55708C`, largeur 16px, radius 4px 4px 0 0, hauteur max ~130px) ; **sous chaque mois : uniquement le NET du mois** (11px Geist Mono 600, vert `#34D399` si positif, rouge `#F87171` si négatif) : JUIL. +110k · AOÛT −130k · SEPT. +280k · OCT. −270k · NOV. +185k ; caption "Net du mois = encaissements − décaissements · net 5 mois : +175 k".
- **Sorties du mois (1/3)** : liste nom + type/date (PAIE, FIXE, SAAS, VARIABLE) + montant mono, total 316 000 MAD en tête.
- **Détail du cash · Juillet (carte bas, interactive)** : titre + récap mono "+420 000 · −310 000 · net +110 000" (net en vert) + **3 chips toggle à droite : "CA clients", "OPEX", "CAPEX"** — chaque chip affiche/masque sa colonne. Chip active : bordure `rgba(47,214,195,0.45)`, fond `rgba(47,214,195,0.10)`, texte `#7FD9CD` ; inactive : bordure `#24384C`, texte `#54697D` ; point de couleur par catégorie (CA `#2FD6C3`, OPEX `#55708C`, CAPEX `#FBBF24`). Colonnes (flex 1 chacune, fond `#0C1824`) : en-tête catégorie + net (CA +420 000 vert ; OPEX −285 000 rouge ; CAPEX −25 000 rouge) puis lignes nom/sous-titre/montant. Si tout est masqué : message "Active une catégorie… " centré `#54697D`. Détail : CA = Atlas +168 000 (acompte 40% · 15/07), Sahara +153 000 (jalon 2 · 22/07), Medina +78 000 (solde · 08/07 · retard), Argan +21 000 ; OPEX = Salaires −185 000, Loyers −58 000, Abonnements IA −42 000 ; CAPEX = Postes & matériel −14 000, Setup data warehouse −11 000.
- **Plans de paiement (tableau bas)** : colonnes CLIENT/PROJET · PLAN (ex. "30 / 40 / 30") · PROCHAIN (montant mono 600) · ÉCHÉANCE · STATUT (badge : À l'heure vert / À risque ambre / En retard rouge).

### 5. CRM Pipeline — `/dashboard/leads` (tour 1, exploration)

Trois directions montrées (1a clair "Maison", 1b sombre "Cockpit", 1c clair "Éditorial"). **1b** est la plus proche de la direction retenue : kanban 6 colonnes (À contacter, Contacté, Relance, Meeting, Propale, Gagné), colonnes fond `#0E1B29` avec liseré 2px couleur de statut en haut, cartes lead (société 12px/600, sujet, prochaine action, date de relance — ⚑ ambre si en retard, source en MAJ 8.5px), rail vertical "SANS SUITE". À harmoniser avec les tokens de la série 3 lors de l'implémentation.

## Interactions & Behavior

- **Hover lignes de tableau** : fond `#112130` · hover cartes kanban : bordure teal · boutons primaires : `#2FD6C3 → #5CE0D0`
- **Chips CA clients / OPEX / CAPEX** (Finance) : toggle indépendant, la grille se recompose (flex) ; état conservé côté client (useState) ; les 3 actives par défaut
- **Segmented controls** (Kanban/Calendrier/Liste ; 30j/90j/180j) : segment actif fond `#1C3145`, texte `#E9F0F6`
- **Sidebar** : sous-menu CRM repliable (chevron) ; item actif fond teal translucide
- **Thème** : ces specs = thème sombre ; le repo utilise `next-themes` — décliner le mode clair à partir des équivalents du tour 2 (fond `#F6F3EC`/`#FCFBF7`, navy `#14293C`, laiton `#B08D4F`) si souhaité
- Transitions : `background/border 150ms ease` suffisent ; pas d'animations décoratives

## State Management

- Finance : `{ showCA: bool, showOPEX: bool, showCAPEX: bool }` (défaut true×3) ; période sélectionnée (30/90/180j)
- Projets : données groupées `client → projets[]` avec `{start, end, progress, risk: 'ok'|'watch'|'high', slipMonth, blocker}` ; la ligne "vue globale" se calcule (count de projets actifs par mois)
- RH : `roles[] {title, etp, reason, arrivalMonth, steps: {annonce|test|entretiens|offre: 'done'|'active'|'todo'}, status}`
- Sources : seed CRM + `src/features/naia/operating-data.ts` (portfolio, hiring, cash) — remplacer par les vraies requêtes

## Assets

- `public/brand/naia-os-q.png` — monogramme Q (tuile logo sidebar) — provient du repo
- `public/brand/naia-os-logo.png`, `naia-os-logo-white.png`, `naia-os-logo-small.png` — logos complets (login/exports) — proviennent du repo
- Icônes : **lucide-react** (déjà dans le codebase)
- Fonts Google : **Playfair Display** (500–700 + italic), **Geist** (400–700), **Geist Mono** (400–600)

## Files

- `CRM Pipeline Redesign.dc.html` — document de design complet (ouvrir dans un navigateur ; toutes les options 1a→3c, la série 3 fait foi)
- `public/brand/*.png` — assets de marque

## Screenshots

Captures de référence dans `screenshots/` :

- `3a-projets.png` · `3b-rh.png` · `3c-finance.png` — **direction retenue à implémenter**
- `1a-crm-maison.png` · `1b-crm-cockpit.png` · `1c-crm-editorial.png` — explorations CRM Pipeline (contexte)
