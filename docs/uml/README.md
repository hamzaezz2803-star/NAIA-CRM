# Diagrammes UML — NAIA-os

Diagrammes construits à partir du schéma Supabase (`supabase/migrations`), des rôles
(`src/platform/core/permissions.ts`) et des actions serveur du CRM
(`src/features/crm/actions.ts`). Chaque fichier `.puml` est la source et peut être
modifié puis régénéré ; les `.png` et `.svg` sont générés.

| # | Diagramme | Source | Image |
|---|---|---|---|
| 1 | Cas d'utilisation (global) | [01-cas-utilisation.puml](01-cas-utilisation.puml) | [PNG](01-cas-utilisation.png) · [SVG](01-cas-utilisation.svg) |
| 2 | Classes (global) | [02-classes.puml](02-classes.puml) | [PNG](02-classes.png) · [SVG](02-classes.svg) |
| 3 | Séquence — Créer un lead | [03-sequence-creer-lead.puml](03-sequence-creer-lead.puml) | [PNG](03-sequence-creer-lead.png) · [SVG](03-sequence-creer-lead.svg) |
| 4 | Séquence — Marquer la prochaine action comme faite | [04-sequence-marquer-action-faite.puml](04-sequence-marquer-action-faite.puml) | [PNG](04-sequence-marquer-action-faite.png) · [SVG](04-sequence-marquer-action-faite.svg) |

## Régénérer les images

Java et `plantuml.jar` suffisent : les diagrammes utilisent le moteur de mise en page
intégré (`!pragma layout smetana`), sans Graphviz.

```bash
java -jar plantuml.jar -charset UTF-8 -tpng -tsvg docs/uml/*.puml
```

## Cohérence entre les diagrammes

Ce sont des vues globales : seules les classes, attributs et étapes principales
sont représentés.

- Les acteurs Utilisateur et Administrateur correspondent à l'énumération `Role`
  du diagramme de classes (`organization_memberships.role`).
- « Gérer les leads » (cas d'utilisation) est illustré par les deux séquences :
  la séquence 1 crée `Entreprise`, `Contact` et `Lead`, la séquence 2 appelle
  `Lead.marquerActionFaite()` et termine la `Tache` liée.
- Google Workspace intervient dans les mêmes cas d'utilisation que dans la
  séquence 1 (événement Google Calendar).
