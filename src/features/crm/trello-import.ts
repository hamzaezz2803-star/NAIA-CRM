import { createHash } from "node:crypto";
import { z } from "zod";

import {
  containsSensitiveCrmText,
  type CrmAccessScope,
} from "./confidentiality";

export type { CrmAccessScope } from "./confidentiality";

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
    cofounderLeads: number;
    cofoundersOnly: number;
    leads: number;
    openLeads: number;
    tags: number;
  };
  items: TrelloImportStagingItem[];
  review: {
    duplicateLeadTitleExtraRows: number;
    duplicateLeadTitleGroups: number;
    existingCrmAmbiguousItems: number;
    existingCrmDeterministicMatches: number;
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

export type ExistingCrmReconciliationSnapshot = {
  categories: Array<{
    accessScope: CrmAccessScope;
    id: string;
    statusKey: string;
  }>;
  externalRefs: Array<{
    archivedAt: string | null;
    externalId: string;
    externalType: "category" | "lead" | "tag";
    localId: string;
    sourceHash: string;
  }>;
  leads: Array<{
    accessScope: CrmAccessScope;
    id: string;
    topic: string;
  }>;
  tags: Array<{
    accessScope: CrmAccessScope;
    id: string;
    name: string;
  }>;
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
    dueComplete: z.boolean().default(false),
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

const ORGANIZATION_SAFE_LIST_PATTERN =
  /^(backlog\b|to be contacted\b|contacted\b|a relancer\b|en attente de reponse\b|presentation a envoyer\b|meeting booked\b|proposal\b|done\b|contract to be signed\b|cold call\b|lost\b)/i;
const ORGANIZATION_SAFE_LABEL_PATTERN =
  /^(urgent|priorit[eé]|hot|warm|cold|client|prospect|follow[- ]?up|relance)$/i;
const BOARD_LABEL_ALLOWLIST: Readonly<Record<string, ReadonlySet<string>>> = {
  // Commercial Lead Consulting board. Exact, reviewed labels only; every
  // unknown label on this or another board remains founder-only.
  "69de18c4a11891f0f0aae68a": new Set(["updated"]),
};
const ASSIGNEE_EMAIL_BY_BOARD_LABEL_ID: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  "69de18c4a11891f0f0aae68a": {
    "69de18c5a11891f0f0aae8ec": "nabil@qarizmi.com",
    "69de18c5a11891f0f0aae8f0": "ali@qarizmi.com",
  },
};
const CREDENTIAL_KEY_TERMS = [
  "token",
  "apikey",
  "secret",
  "password",
  "authorization",
  "cookie",
  "signature",
  "credential",
  "accesskey",
  "accessid",
  "keypairid",
  "session",
  "jwt",
  "bearer",
  "oauth",
  "privatekey",
  "presigned",
  "policy",
] as const;
const SAFE_ATTACHMENT_QUERY_KEYS = new Set(["dl", "download", "inline"]);

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

function isCredentialKey(key: string) {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return (
    normalized === "auth" ||
    normalized === "code" ||
    normalized === "key" ||
    normalized === "sig" ||
    normalized === "ticket" ||
    CREDENTIAL_KEY_TERMS.some((term) => normalized.includes(term))
  );
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
    if (isCredentialKey(key)) return key;
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

function privateTrelloLabelToken(boardId: string, labelId: string) {
  return createHash("sha256")
    .update("trello-blank-label\0")
    .update(boardId)
    .update("\0")
    .update(labelId)
    .digest("hex");
}

export function createTrelloStagingAttestation(
  items: TrelloImportStagingItem[],
) {
  const canonicalRows = items
    .map(
      (item) =>
        `${item.entityType}\u001f${item.externalId}\u001f${item.payloadHash}\u001f${sha256StableJson(item.validationErrors)}`,
    )
    .sort();
  return {
    expectedItemCount: items.length,
    stagingHash: createHash("sha256")
      .update(canonicalRows.join("\n"))
      .digest("hex"),
  };
}

function statusKeyForList(externalId: string) {
  const safeId = externalId
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `trello-list-${safeId || sha256StableJson(externalId).slice(0, 16)}`;
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
    url.username = "";
    url.password = "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (
        isCredentialKey(key) ||
        !SAFE_ATTACHMENT_QUERY_KEYS.has(key.toLowerCase())
      ) {
        url.searchParams.delete(key);
      }
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

function assignedToEmailForLabel(boardId: string, labelId: string) {
  return ASSIGNEE_EMAIL_BY_BOARD_LABEL_ID[boardId]?.[labelId];
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

export function normalizeCrmMatchText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function addValidationError(
  item: TrelloImportStagingItem,
  error: string,
): TrelloImportStagingItem {
  return {
    ...item,
    validationErrors: [...new Set([...item.validationErrors, error])],
  };
}

export function reconcileTrelloImportWithExistingCrm(
  dryRun: TrelloImportDryRun,
  snapshot: ExistingCrmReconciliationSnapshot,
): TrelloImportDryRun {
  const refsByExternalKey = new Map(
    snapshot.externalRefs.map((ref) => [
      `${ref.externalType}:${ref.externalId}`,
      ref,
    ]),
  );
  const managedLocalIds = new Set(
    snapshot.externalRefs.map((ref) => ref.localId),
  );
  const categoriesByStatus = new Map<string, typeof snapshot.categories>();
  const tagsByName = new Map<string, typeof snapshot.tags>();
  const leadsByTopic = new Map<string, typeof snapshot.leads>();
  const stagedTagCounts = new Map<string, number>();
  const stagedLeadCounts = new Map<string, number>();

  for (const category of snapshot.categories) {
    if (managedLocalIds.has(category.id)) continue;
    const matches = categoriesByStatus.get(category.statusKey) ?? [];
    matches.push(category);
    categoriesByStatus.set(category.statusKey, matches);
  }
  for (const tag of snapshot.tags) {
    if (managedLocalIds.has(tag.id)) continue;
    const key = normalizeCrmMatchText(tag.name);
    const matches = tagsByName.get(key) ?? [];
    matches.push(tag);
    tagsByName.set(key, matches);
  }
  for (const lead of snapshot.leads) {
    if (managedLocalIds.has(lead.id)) continue;
    const key = normalizeCrmMatchText(lead.topic);
    const matches = leadsByTopic.get(key) ?? [];
    matches.push(lead);
    leadsByTopic.set(key, matches);
  }
  for (const item of dryRun.items) {
    if (refsByExternalKey.has(`${item.entityType}:${item.externalId}`)) {
      continue;
    }
    if (item.entityType === "tag") {
      const key = normalizeCrmMatchText(String(item.payload.name ?? ""));
      stagedTagCounts.set(key, (stagedTagCounts.get(key) ?? 0) + 1);
    } else if (item.entityType === "lead") {
      const key = normalizeCrmMatchText(String(item.payload.topic ?? ""));
      stagedLeadCounts.set(key, (stagedLeadCounts.get(key) ?? 0) + 1);
    }
  }

  let ambiguous = 0;
  let deterministicMatches = 0;
  const items = dryRun.items.map((originalItem) => {
    const referenceKey = `${originalItem.entityType}:${originalItem.externalId}`;
    const existingReference = refsByExternalKey.get(referenceKey);
    if (existingReference) {
      if (
        existingReference.archivedAt &&
        existingReference.sourceHash !== originalItem.payloadHash
      ) {
        ambiguous += 1;
        return addValidationError(
          originalItem,
          `existing-crm:rolled-back-${originalItem.entityType}-changed`,
        );
      }
      return originalItem;
    }

    let item = originalItem;
    let candidates: Array<{ accessScope: CrmAccessScope; id: string }> = [];
    if (item.entityType === "category") {
      candidates =
        categoriesByStatus.get(String(item.payload.statusKey ?? "")) ?? [];
    } else if (item.entityType === "tag") {
      const nameKey = normalizeCrmMatchText(String(item.payload.name ?? ""));
      candidates = tagsByName.get(nameKey) ?? [];
      if (candidates.length > 0 && (stagedTagCounts.get(nameKey) ?? 0) > 1) {
        item = addValidationError(
          item,
          "existing-crm:ambiguous-staged-tag-name",
        );
        ambiguous += 1;
        return item;
      }
    } else {
      const topicKey = normalizeCrmMatchText(String(item.payload.topic ?? ""));
      candidates = leadsByTopic.get(topicKey) ?? [];
      if (candidates.length > 0 && (stagedLeadCounts.get(topicKey) ?? 0) > 1) {
        item = addValidationError(
          item,
          "existing-crm:ambiguous-staged-lead-title",
        );
        ambiguous += 1;
        return item;
      }
    }

    if (candidates.length > 1) {
      item = addValidationError(
        item,
        `existing-crm:ambiguous-${item.entityType}-match`,
      );
      ambiguous += 1;
      return item;
    }
    const candidate = candidates[0];
    if (!candidate) return item;
    if (candidate.accessScope !== item.accessScope) {
      item = addValidationError(
        item,
        `existing-crm:${item.entityType}-scope-mismatch`,
      );
      ambiguous += 1;
      return item;
    }

    deterministicMatches += 1;
    return item;
  });

  return {
    ...dryRun,
    items,
    review: {
      ...dryRun.review,
      existingCrmAmbiguousItems: ambiguous,
      existingCrmDeterministicMatches: deterministicMatches,
    },
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
    if (containsSensitiveCrmText(list.name)) {
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
    if (assignedToEmailForLabel(board.id, label.id)) continue;
    if (!label.name.trim() || containsSensitiveCrmText(label.name)) {
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
          name: list.name.trim() || "Liste Trello sans nom",
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
    if (assignedToEmailForLabel(board.id, label.id)) continue;
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
          name:
            label.name.trim() ||
            `Label Trello privé ${privateTrelloLabelToken(board.id, label.id).slice(0, 10)}`,
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
    warnings.push(
      `${blankLabelCount} label(s) sans nom conservé(s) comme tag(s) cofondateurs.`,
    );
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
          name: attachment.name.trim() || "Pièce jointe Trello",
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
    const assignmentLabels = card.idLabels.flatMap((labelId) => {
      const label = labelsById.get(labelId);
      const email = label
        ? assignedToEmailForLabel(board.id, label.id)
        : undefined;
      return email ? [{ email, labelId }] : [];
    });
    const assignedToEmail =
      assignmentLabels.length === 1 ? assignmentLabels[0]?.email : undefined;
    const hasAmbiguousAssignment = assignmentLabels.length > 1;
    const privacyReasons: string[] = [];
    let accessScope: CrmAccessScope = "organization";
    let hasUnnamedLabel = false;
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
      if (label && assignedToEmailForLabel(board.id, label.id)) continue;
      if (label && !label.name.trim()) {
        accessScope = "cofounders";
        hasUnnamedLabel = true;
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
    if (containsSensitiveCrmText(card.name, normalizedNotes)) {
      accessScope = "cofounders";
      privacyReasons.push("sensitive-keyword:card-content");
    }
    if (hasUnnamedLabel) {
      privacyReasons.push("label:fail-closed:unnamed-label");
    }
    if (hasAmbiguousAssignment) {
      accessScope = "cofounders";
      privacyReasons.push("fail-closed:multiple-assignee-labels");
      warnings.push(
        `Carte Trello avec plusieurs labels d'assignation refusée (${card.id}).`,
      );
    }
    const due = validDueDate(card.due);
    if (card.due && !due) {
      warnings.push(`Échéance Trello invalide ignorée (${card.id}).`);
    }
    const knownLabelIds = card.idLabels.filter((labelId) => {
      const label = labelsById.get(labelId);
      return label ? !assignedToEmailForLabel(board.id, label.id) : false;
    });
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
          ...(assignedToEmail ? { assignedToEmail } : {}),
          dueComplete: card.dueComplete,
          labelExternalIds: knownLabelIds,
          ...(due ? { leadDate: due } : {}),
          ...(firstIncompleteItem?.name.trim()
            ? {
                nextAction: firstIncompleteItem.name.trim(),
                nextActionState: "pending",
              }
            : due
              ? {
                  nextAction: "Échéance Trello",
                  nextActionState: card.dueComplete ? "done" : "pending",
                }
              : {}),
          notes: normalizedNotes,
          source: "Trello",
          sourceMeta: {
            assignedMemberExternalIds: card.idMembers,
            attachments: attachmentMetadata,
          },
          status: card.closed
            ? "dead-end"
            : statusKeyForList(list?.id ?? orphanCategoryExternalId),
          topic: card.name.trim() || "Carte Trello sans titre",
        },
        privacyReasons: [...new Set(privacyReasons)],
        validationErrors: hasAmbiguousAssignment
          ? ["trello:multiple-assignee-labels"]
          : [],
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
      cofounderLeads: items.filter(
        (item) =>
          item.entityType === "lead" && item.accessScope === "cofounders",
      ).length,
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
      existingCrmAmbiguousItems: 0,
      existingCrmDeterministicMatches: 0,
    },
    sourceHash: sha256StableJson(canonicalSource),
    warnings: [...new Set(warnings)],
  };
}
