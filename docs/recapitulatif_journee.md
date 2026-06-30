# Récapitulatif des Fonctionnalités - Mise à jour du jour

Ce document trace l'ensemble des améliorations, correctifs et nouvelles fonctionnalités intégrés aujourd'hui à la plateforme **NAIA-os**.

## 1. Identité Visuelle et Thèmes (Mode Clair / Sombre)

- **Rebranding** : Le nom "QARIZMI" a été entièrement remplacé par **"NAIA-os"** dans l'interface, les titres des onglets et la barre latérale.
- **Logo** : Correction du comportement du logo afin qu'il préserve ses couleurs d'origine sur un fond clair (le filtre d'inversion a été retiré).
- **Titre de la Sidebar** : Le contraste du titre "NAIA-os" a été optimisé. Il s'affiche désormais en **blanc pur** et gras sur le thème sombre, et en noir sur le thème clair.
- **Bouton de Réduction** : Le bouton pour replier/déplier la barre latérale a été agrandi (passant d'une petite icône à un vrai bouton carré de taille `40x40px` avec un fond visible au survol) afin d'améliorer considérablement l'expérience utilisateur (UX).

## 2. Profil Utilisateur & Paramètres

- **Page Paramètres (`/dashboard/settings`)** : Ajout d'une nouvelle page complète accessible via le menu du profil en bas à gauche.
- **Informations du Compte** : Affichage dynamique des détails de l'utilisateur connecté (Nom, Email, Rôle, Organisation).
- **Sécurité** : Ajout d'un formulaire sécurisé permettant de changer le mot de passe de l'utilisateur directement depuis les paramètres (avec vérification de la longueur minimale et communication en direct avec Supabase Auth).

## 3. Nouveau Centre de Notifications Intelligent 🔔

- **Cloche Dynamique** : L'ancienne icône de cloche statique a été remplacée par un composant intelligent (`<NotificationBell />`).
- **Rappels Automatiques (Leads)** : Le système parcourt automatiquement la base de données. Si la date de prochaine action (`next_action_date`) d'un prospect (Lead) correspond à la date d'aujourd'hui ou à une date passée, un **rappel intelligent** est généré automatiquement.
- **Indicateur Visuel** : Un **point rouge clignotant** (badge) apparaît sur la cloche lorsqu'il y a de nouvelles notifications non lues.
- **Menu Déroulant Complet** : Au clic, un menu liste les notifications avec des icônes différentes selon le type, un formatage agréable (temps écoulé : "il y a 5 min"), et des liens redirigeant vers la ressource concernée.

## 4. Traçabilité des Actions du CRM (Système d'Événements)

- **Notifications Système** : Une nouvelle table `notifications` a été créée dans la base de données (migration SQL).
- **Journalisation Automatique** : Les actions majeures génèrent désormais une trace temporelle avec la date et l'heure exactes (ex: _le 26/06/2026 à 14:15_) et sont transmises dans la cloche de notifications.
- Actions suivies avec notifications :
  1. **Création d'un Lead** (Notification de succès).
  2. **Suppression d'un Lead** (Alerte système).
  3. **Création d'un dossier Google Drive** pour un client (Succès avec lien direct).
  4. **Génération d'un brouillon d'e-mail / WhatsApp via l'IA Groq** (Notification système).

---

_Fin du récapitulatif._
