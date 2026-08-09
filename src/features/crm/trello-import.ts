import { createHash } from "node:crypto";
import { z } from "zod";

export type CrmAccessScope = "cofounders" | "organization";

export type TrelloImportStagingItem = {
  accessScope: CrmAccessScope;
  entityType: "category" | "lead" | "tag";
  externalId: string;
  parentExternalId?: string;
  payload: Record<string, unknown>;
  payloadHash: string;
  privacyReasons: string[];
  validationErrors: string[];
};

export type TrelloImportDryRun = {
  board: { externalId: string; name: string };
  counts: {
    categories: number;
    checklistItems: number;
    checklists: number;
    cofoundersOnly: number;
    leads: number;
    openLeads: number;
    tags: number;
  };
  items: TrelloImportStagingItem[];
  review: {
    duplicateLeadTitleExtraRows: number;
    duplicateLeadTitleGroups: number;
  };
  preserved: {
    attachments: number;
    cardsWithDescriptions: number;
    commentActionsIgnored: number;
    dueDates: number;
    memberAssignments: number;
  };
  sourceHash: string;
  warnings: string[];
};

const trelloId = z.string().trim().min(1).max(256);
const trelloLabelSchema = z
  .object({
    color: z.string().trim().max(64).nullable().optional(),
    id: trelloId,
    name: z.string().max(500).default(""),
  })
  .strip();
const trelloListSchema = z
  .object({
    closed: z.boolean().default(false),
    id: trelloId,
    name: z.string().max(1_000),
    pos: z.number().finite().optional(),
  })
  .strip();
const trelloCardSchema = z
  .object({
    attachments: z
      .array(
        z
          .object({
            date: z.string().max(128).nullable().optional(),
            id: trelloId,
            mimeType: z.string().max(256).nullable().optional(),
            name: z.string().max(2_000).default("Pièce jointe Trello"),
            url: z.string().max(10_000),
          })
          .strip(),
      )
      .max(500)
      .default([]),
    closed: z.boolean().default(false),
    desc: z.string().max(100_000).default(""),
    due: z.string().nullable().optional(),
    id: trelloId,
    idLabels: z.array(trelloId).max(200).default([]),
    idList: trelloId,
    idMembers: z.array(trelloId).max(200).default([]),
    name: z.string().max(10_000),
    pos: z.number().finite().optional(),
  })
  .strip();
const trelloCheckItemSchema = z
  .object({
    id: trelloId,
    name: z.string().max(10_000),
    pos: z.number().finite().optional(),
    state: z.enum(["complete", "incomplete"]).default("incomplete"),
  })
  .strip();
const trelloChecklistSchema = z
  .object({
    checkItems: z.array(trelloCheckItemSchema).max(10_000).default([]),
    id: trelloId,
    idCard: trelloId,
    name: z.string().max(1_000).default("Checklist"),
  })
  .strip();
const trelloBoardSchema = z
  .object({
    cards: z.array(trelloCardSchema).max(100_000),
    checklists: z.array(trelloChecklistSchema).max(10_000).default([]),
    id: trelloId,
    labels: z.array(trelloLabelSchema).max(10_000).default([]),
    lists: z.array(trelloListSchema).max(10_000),
    name: z.string().max(1_000),
  })
  .strip();

const FOUNDER_ONLY_PATTERN =
  /\b(stagiaire|stagiaires|intern|interns|internship|candidat|candidats|recrutement|ressources humaines|human resources|rh|hr)\b/i;
const ORGANIZATION_SAFE_LIST_PATTERN =
  /^(backlog\b|to be contacted\b|contacted\b|a relancer\b|en attente de reponse\b|presentation a envoyer\b|meeting booked\b|proposal\b|done\b|contract to be signed\b|cold call\b|lost\b)/i;
const ORGANIZATION_SAFE_LABEL_PATTERN =
  /^(urgent|priorit[eé]|hot|warm|cold|client|prospect|follow[- ]?up|relance)$/i;
const BOARD_LABEL_ALLOWLIST: Readonly<Record<string, ReadonlySet<string>>> = {
  // Commercial Lead Consulting board. Exact, reviewed labels only; every
  // unknown label on this or another board remains founder-only.
  "69de18c4a11891f0f0aae68a": new Set(["ali", "nabil", "updated"]),
};
const CREDENTIAL_KEY_PATTERN =
  /^(token|api[-_]?key|secret|password|authorization|cookie)$/i;

const COLOR_MAP: Record<string, string> = {
  black: "gray",
  blue: "blue",
  green: "emerald",
  lime: "lime",
  orange: "orange",
  pink: "pink",
  purple: "purple",
  red: "red",
  sky: "sky",
  yellow: "yellow",
};

function parseJsonInput(input: string | unknown): unknown {
  if (typeof input !== "string") return input;

  try {
    return JSON.parse(input) as unknown;
  } catch {
    throw new Error("Le fichier Trello n'est pas un JSON valide.");
  }
}

function findCredentialKey(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findCredentialKey(item);
      if (found) return found;
    }
    return null;
  }

  for (const [key, child] of Object.entries(value)) {
    if (CREDENTIAL_KEY_PATTERN.test(key)) return key;
    const found = findCredentialKey(child);
    if (found) return found;
  }
  return null;
}

function stableJson(value: unknown): string {
  if (value === undefined) return "null";
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256StableJson(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function statusKeyForList(externalId: string) {
  const safeId = externalId
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `trello-list-${safeId || sha256StableJson(externalId).slice(0, 16)}`;
}

function truncate(
  value: string,
  maxLength: number,
  warning: string,
  warnings: string[],
) {
  if (value.length <= maxLength) return value;
  warnings.push(warning);
  return value.slice(0, maxLength);
}

function validDueDate(value: string | null | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function safeAttachmentUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return undefined;
    for (const key of [...url.searchParams.keys()]) {
      if (CREDENTIAL_KEY_PATTERN.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function isOrganizationSafeLabel(boardId: string, labelName: string) {
  const normalized = labelName.trim().toLocaleLowerCase("fr");
  return (
    ORGANIZATION_SAFE_LABEL_PATTERN.test(labelName.trim()) ||
    BOARD_LABEL_ALLOWLIST[boardId]?.has(normalized) === true
  );
}

function duplicateCounts(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = value.trim().toLocaleLowerCase("fr");
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const duplicates = [...counts.values()].filter((count) => count > 1);
  return {
    extraRows: duplicates.reduce((sum, count) => sum + count - 1, 0),
    groups: duplicates.length,
  };
}

function stagingItem(
  item: Omit<TrelloImportStagingItem, "payloadHash" | "privacyReasons"> & {
    privacyReasons?: string[];
  },
): TrelloImportStagingItem {
  return {
    ...item,
    payloadHash: sha256StableJson({
      accessScope: item.accessScope,
      entityType: item.entityType,
      externalId: item.externalId,
      parentExternalId: item.parentExternalId,
      payload: item.payload,
      privacyReasons: item.privacyReasons ?? [],
    }),
    privacyReasons: item.privacyReasons ?? [],
  };
}

export function normalizeTrelloExport(
  input: string | unknown,
): TrelloImportDryRun {
  const parsedInput = parseJsonInput(input);
  const credentialKey = findCredentialKey(parsedInput);
  if (credentialKey) {
    throw new Error(
      `Le JSON contient un champ de credential interdit (${credentialKey}). Exporte uniquement les données du board.`,
    );
  }

  const parsed = trelloBoardSchema.safeParse(parsedInput);
  if (!parsed.success) {
    throw new Error(
      `Export Trello invalide: ${parsed.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }

  const board = parsed.data;
  const warnings: string[] = [];
  const rawRecord =
    parsedInput &&
    typeof parsedInput === "object" &&
    !Array.isArray(parsedInput)
      ? (parsedInput as Record<string, unknown>)
      : {};
  const ignoredActionCount = Array.isArray(rawRecord.actions)
    ? rawRecord.actions.length
    : 0;
  const ignoredCommentActionCount = Array.isArray(rawRecord.actions)
    ? rawRecord.actions.filter(
        (action) =>
          action &&
          typeof action === "object" &&
          (action as Record<string, unknown>).type === "commentCard",
      ).length
    : 0;
  const ignoredMemberCount = Array.isArray(rawRecord.members)
    ? rawRecord.members.length
    : 0;
  if (ignoredActionCount > 0) {
    warnings.push(
      `${ignoredActionCount} action(s) d'audit Trello ignorée(s); elles ne sont jamais persistées.`,
    );
  }
  if (ignoredMemberCount > 0) {
    warnings.push(
      `${ignoredMemberCount} profil(s) membre Trello ignoré(s); seuls les identifiants d'assignation sont conservés en sourceMeta.`,
    );
  }
  const labelsById = new Map(board.labels.map((label) => [label.id, label]));
  const listsById = new Map(board.lists.map((list) => [list.id, list]));
  const checklistsByCard = new Map<string, typeof board.checklists>();
  for (const checklist of board.checklists) {
    const cardChecklists = checklistsByCard.get(checklist.idCard) ?? [];
    cardChecklists.push(checklist);
    checklistsByCard.set(checklist.idCard, cardChecklists);
  }
  const listPrivacy = new Map<
    string,
    { accessScope: CrmAccessScope; reasons: string[] }
  >();
  for (const list of board.lists) {
    if (FOUNDER_ONLY_PATTERN.test(list.name)) {
      listPrivacy.set(list.id, {
        accessScope: "cofounders",
        reasons: ["sensitive-keyword:list"],
      });
    } else if (ORGANIZATION_SAFE_LIST_PATTERN.test(list.name.trim())) {
      listPrivacy.set(list.id, {
        accessScope: "organization",
        reasons: ["explicit-sales-stage-allowlist"],
      });
    } else {
      listPrivacy.set(list.id, {
        accessScope: "cofounders",
        reasons: ["fail-closed:unreviewed-list"],
      });
    }
  }
  const labelPrivacy = new Map<
    string,
    { accessScope: CrmAccessScope; reasons: string[] }
  >();
  for (const label of board.labels) {
    if (!label.name.trim() || FOUNDER_ONLY_PATTERN.test(label.name)) {
      labelPrivacy.set(label.id, {
        accessScope: "cofounders",
        reasons: [
          label.name.trim()
            ? "sensitive-keyword:label"
            : "fail-closed:unnamed-label",
        ],
      });
    } else if (isOrganizationSafeLabel(board.id, label.name)) {
      labelPrivacy.set(label.id, {
        accessScope: "organization",
        reasons: ["explicit-sales-label-allowlist"],
      });
    } else {
      labelPrivacy.set(label.id, {
        accessScope: "cofounders",
        reasons: ["fail-closed:unreviewed-label"],
      });
    }
  }
  const orphanCards = board.cards.filter((card) => !listsById.has(card.idList));

  const items: TrelloImportStagingItem[] = [];
  for (const [index, list] of [...board.lists]
    .filter((candidate) => !candidate.closed)
    .sort((left, right) => (left.pos ?? 0) - (right.pos ?? 0))
    .entries()) {
    const privacy = listPrivacy.get(list.id) ?? {
      accessScope: "cofounders" as const,
      reasons: ["fail-closed:missing-list-rule"],
    };
    const accessScope = privacy.accessScope;
    items.push(
      stagingItem({
        accessScope,
        entityType: "category",
        externalId: list.id,
        payload: {
          color: accessScope === "cofounders" ? "purple" : "gray",
          name: truncate(
            list.name.trim() || "Liste Trello sans nom",
            200,
            `Nom de liste tronqué (${list.id}).`,
            warnings,
          ),
          position: index + 1,
          statusKey: statusKeyForList(list.id),
        },
        privacyReasons: privacy.reasons,
        validationErrors: [],
      }),
    );
  }

  const orphanCategoryExternalId = `unmapped-${board.id}`;
  if (orphanCards.length > 0) {
    warnings.push(
      `${orphanCards.length} carte(s) sans liste reconnue seront placées dans une catégorie cofondateurs.`,
    );
    items.push(
      stagingItem({
        accessScope: "cofounders",
        entityType: "category",
        externalId: orphanCategoryExternalId,
        payload: {
          color: "purple",
          name: "À classer (import Trello)",
          position: board.lists.length + 1,
          statusKey: statusKeyForList(orphanCategoryExternalId),
        },
        privacyReasons: ["fail-closed:orphan-card-category"],
        validationErrors: [],
      }),
    );
  }

  for (const label of board.labels) {
    if (!label.name.trim()) continue;
    const privacy = labelPrivacy.get(label.id) ?? {
      accessScope: "cofounders" as const,
      reasons: ["fail-closed:missing-label-rule"],
    };
    const accessScope = privacy.accessScope;
    items.push(
      stagingItem({
        accessScope,
        entityType: "tag",
        externalId: label.id,
        payload: {
          color: COLOR_MAP[label.color ?? ""] ?? "teal",
          name: truncate(
            label.name.trim(),
            120,
            `Nom de label tronqué (${label.id}).`,
            warnings,
          ),
        },
        privacyReasons: privacy.reasons,
        validationErrors: [],
      }),
    );
  }

  const blankLabelCount = board.labels.filter(
    (label) => !label.name.trim(),
  ).length;
  if (blankLabelCount > 0) {
    warnings.push(`${blankLabelCount} label(s) sans nom ignoré(s).`);
  }

  const closedCardCount = board.cards.filter((card) => card.closed).length;
  if (closedCardCount > 0) {
    warnings.push(
      `${closedCardCount} carte(s) archivée(s) Trello seront conservées au statut dead-end.`,
    );
  }

  const duplicateLeadTitles = duplicateCounts(
    board.cards.map((card) => card.name),
  );
  if (duplicateLeadTitles.groups > 0) {
    warnings.push(
      `${duplicateLeadTitles.groups} groupe(s) de titres de leads en doublon nécessitent une revue.`,
    );
  }

  for (const card of [...board.cards].sort(
    (left, right) => (left.pos ?? 0) - (right.pos ?? 0),
  )) {
    const list = listsById.get(card.idList);
    const cardChecklists = checklistsByCard.get(card.id) ?? [];
    const attachmentMetadata = card.attachments.flatMap((attachment) => {
      const url = safeAttachmentUrl(attachment.url);
      if (!url) {
        warnings.push(`URL de pièce jointe invalide ignorée (${card.id}).`);
        return [];
      }
      return [
        {
          date: validDueDate(attachment.date),
          externalId: attachment.id,
          mimeType: attachment.mimeType ?? undefined,
          name: truncate(
            attachment.name.trim() || "Pièce jointe Trello",
            500,
            `Nom de pièce jointe tronqué (${card.id}).`,
            warnings,
          ),
          url,
        },
      ];
    });
    const attachmentText = attachmentMetadata
      .map(
        (attachment) =>
          `- [${attachment.name}](${attachment.url})${
            attachment.mimeType ? ` (${attachment.mimeType})` : ""
          }`,
      )
      .join("\n");
    const checklistText = cardChecklists
      .map((checklist) => {
        const lines = [...checklist.checkItems]
          .sort((left, right) => (left.pos ?? 0) - (right.pos ?? 0))
          .map(
            (item) =>
              `- [${item.state === "complete" ? "x" : " "}] ${item.name.trim()}`,
          );
        return [`Checklist: ${checklist.name.trim() || "Checklist"}`, ...lines]
          .join("\n")
          .trim();
      })
      .filter(Boolean)
      .join("\n\n");
    const normalizedNotes = [
      card.desc.trim(),
      checklistText,
      attachmentText ? `Pièces jointes Trello:\n${attachmentText}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    const firstIncompleteItem = cardChecklists
      .flatMap((checklist) => checklist.checkItems)
      .sort((left, right) => (left.pos ?? 0) - (right.pos ?? 0))
      .find((item) => item.state !== "complete");
    const privacyReasons: string[] = [];
    let accessScope: CrmAccessScope = "organization";
    const listRule = list ? listPrivacy.get(list.id) : undefined;
    if (!list || !listRule) {
      accessScope = "cofounders";
      privacyReasons.push("fail-closed:orphan-or-unreviewed-list");
    } else {
      privacyReasons.push(
        ...listRule.reasons.map((reason) => `list:${reason}`),
      );
      if (listRule.accessScope === "cofounders") accessScope = "cofounders";
    }
    for (const labelId of card.idLabels) {
      const label = labelsById.get(labelId);
      if (label && !label.name.trim()) {
        privacyReasons.push("ignored:unnamed-label-without-semantic-payload");
        continue;
      }
      const labelRule = labelPrivacy.get(labelId);
      if (!labelRule) {
        accessScope = "cofounders";
        privacyReasons.push("fail-closed:unknown-label");
        continue;
      }
      privacyReasons.push(
        ...labelRule.reasons.map((reason) => `label:${reason}`),
      );
      if (labelRule.accessScope === "cofounders") accessScope = "cofounders";
    }
    if (FOUNDER_ONLY_PATTERN.test(`${card.name}\n${normalizedNotes}`)) {
      accessScope = "cofounders";
      privacyReasons.push("sensitive-keyword:card-content");
    }
    const due = validDueDate(card.due);
    if (card.due && !due) {
      warnings.push(`Échéance Trello invalide ignorée (${card.id}).`);
    }
    const knownLabelIds = card.idLabels.filter((labelId) =>
      Boolean(labelsById.get(labelId)?.name.trim()),
    );
    const unknownLabelCount = card.idLabels.filter(
      (labelId) => !labelsById.has(labelId),
    ).length;
    if (unknownLabelCount > 0) {
      warnings.push(`Label(s) inconnu(s) ignoré(s) sur la carte ${card.id}.`);
    }

    items.push(
      stagingItem({
        accessScope,
        entityType: "lead",
        externalId: card.id,
        parentExternalId: list?.id ?? orphanCategoryExternalId,
        payload: {
          labelExternalIds: knownLabelIds,
          ...(due ? { leadDate: due } : {}),
          ...(firstIncompleteItem?.name.trim()
            ? {
                nextAction: truncate(
                  firstIncompleteItem.name.trim(),
                  500,
                  `Prochaine action de checklist tronquée (${card.id}).`,
                  warnings,
                ),
              }
            : due
              ? { nextAction: "Échéance Trello" }
              : {}),
          notes: truncate(
            normalizedNotes,
            20_000,
            `Description de carte tronquée (${card.id}).`,
            warnings,
          ),
          source: "Trello",
          sourceMeta: {
            assignedMemberExternalIds: card.idMembers,
            attachments: attachmentMetadata,
          },
          status: card.closed
            ? "dead-end"
            : statusKeyForList(list?.id ?? orphanCategoryExternalId),
          topic: truncate(
            card.name.trim() || "Carte Trello sans titre",
            500,
            `Titre de carte tronqué (${card.id}).`,
            warnings,
          ),
        },
        privacyReasons: [...new Set(privacyReasons)],
        validationErrors: [],
      }),
    );
  }

  const canonicalSource = {
    board: { id: board.id, name: board.name },
    cards: board.cards,
    checklists: board.checklists,
    labels: board.labels,
    lists: board.lists,
  };

  return {
    board: { externalId: board.id, name: board.name },
    counts: {
      categories: items.filter((item) => item.entityType === "category").length,
      checklistItems: board.checklists.reduce(
        (sum, checklist) => sum + checklist.checkItems.length,
        0,
      ),
      checklists: board.checklists.length,
      cofoundersOnly: items.filter((item) => item.accessScope === "cofounders")
        .length,
      leads: board.cards.length,
      openLeads: board.cards.filter((card) => !card.closed).length,
      tags: items.filter((item) => item.entityType === "tag").length,
    },
    items,
    preserved: {
      attachments: board.cards.reduce(
        (sum, card) => sum + card.attachments.length,
        0,
      ),
      cardsWithDescriptions: board.cards.filter((card) => card.desc.trim())
        .length,
      commentActionsIgnored: ignoredCommentActionCount,
      dueDates: board.cards.filter((card) => Boolean(validDueDate(card.due)))
        .length,
      memberAssignments: board.cards.reduce(
        (sum, card) => sum + card.idMembers.length,
        0,
      ),
    },
    review: {
      duplicateLeadTitleExtraRows: duplicateLeadTitles.extraRows,
      duplicateLeadTitleGroups: duplicateLeadTitles.groups,
    },
    sourceHash: sha256StableJson(canonicalSource),
    warnings: [...new Set(warnings)],
  };
}
