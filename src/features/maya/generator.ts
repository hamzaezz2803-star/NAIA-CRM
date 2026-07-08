import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import type { MayaDeckPlan, MayaGenerationManifest } from "./contracts";
import {
  buildMayaDraftFileName,
  type MayaPitchStorageAdapter,
  type MayaStoredDraft,
} from "./storage";

export type MayaPitchDraftResult = {
  draft: MayaStoredDraft;
  manifestPath: string;
};

export async function generateMayaPitchDraft({
  date = new Date(),
  genericDeckFilePath,
  plan,
  storage,
}: {
  date?: Date;
  genericDeckFilePath: string;
  plan: MayaDeckPlan;
  storage: MayaPitchStorageAdapter;
}): Promise<MayaPitchDraftResult> {
  const content = await readFile(genericDeckFilePath);
  const draftContent = customizeMayaPptx(content, plan);
  const draftFileName = buildMayaDraftFileName({
    clientName: plan.brief.clientName,
    date,
  });
  const draft = await storage.writeDraft({
    clientName: plan.brief.clientName,
    content: draftContent,
    fileName: draftFileName,
  });
  const manifest: MayaGenerationManifest = {
    createdAt: date.toISOString(),
    draftFileName,
    plan,
    sourceGenericDeck: genericDeckFilePath,
  };
  const manifestPath = path.join(
    path.dirname(draft.filePath),
    "maya-generation-manifest.json",
  );

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    draft,
    manifestPath,
  };
}

function customizeMayaPptx(content: Buffer, plan: MayaDeckPlan) {
  const zip = unzipSync(new Uint8Array(content));
  removeOmittedCredentialSlides(zip, new Set(plan.omittedSlideNumbers));
  appendDiagnosticSlides(zip, plan);
  return Buffer.from(zipSync(zip, { level: 6 }));
}

function removeOmittedCredentialSlides(
  zip: Record<string, Uint8Array>,
  omittedSlideNumbers: Set<number>,
) {
  if (!omittedSlideNumbers.size) return;

  const presentationPath = "ppt/presentation.xml";
  const relsPath = "ppt/_rels/presentation.xml.rels";
  const presentationXml = readZipText(zip, presentationPath);
  const relsXml = readZipText(zip, relsPath);
  const slideRelationships = parseSlideRelationships(relsXml);
  const removedRelationshipIds = new Set(
    slideRelationships
      .filter((relationship) =>
        omittedSlideNumbers.has(relationship.slideNumber),
      )
      .map((relationship) => relationship.id),
  );

  if (!removedRelationshipIds.size) return;

  writeZipText(
    zip,
    presentationPath,
    presentationXml.replace(/<p:sldId\b[^>]*\/>/g, (tag) => {
      const relationshipId = getXmlAttribute(tag, "r:id");
      return relationshipId && removedRelationshipIds.has(relationshipId)
        ? ""
        : tag;
    }),
  );
  writeZipText(
    zip,
    relsPath,
    relsXml.replace(/<Relationship\b[^>]*\/>/g, (tag) => {
      const relationshipId = getXmlAttribute(tag, "Id");
      return relationshipId && removedRelationshipIds.has(relationshipId)
        ? ""
        : tag;
    }),
  );

  for (const slideNumber of omittedSlideNumbers) {
    delete zip[`ppt/slides/slide${slideNumber}.xml`];
    delete zip[`ppt/slides/_rels/slide${slideNumber}.xml.rels`];
  }

  if (zip["[Content_Types].xml"]) {
    const contentTypesXml = readZipText(zip, "[Content_Types].xml");
    writeZipText(
      zip,
      "[Content_Types].xml",
      [...omittedSlideNumbers].reduce(
        (xml, slideNumber) =>
          xml.replace(
            new RegExp(
              `<Override\\b[^>]*PartName="/ppt/slides/slide${slideNumber}\\.xml"[^>]*/>`,
              "g",
            ),
            "",
          ),
        contentTypesXml,
      ),
    );
  }
}

function appendDiagnosticSlides(
  zip: Record<string, Uint8Array>,
  plan: MayaDeckPlan,
) {
  const diagnosticSlides = buildDiagnosticSlides(plan);
  if (!diagnosticSlides.length) return;

  const presentationPath = "ppt/presentation.xml";
  const relsPath = "ppt/_rels/presentation.xml.rels";
  let presentationXml = readZipText(zip, presentationPath);
  let relsXml = readZipText(zip, relsPath);
  let contentTypesXml = readZipText(zip, "[Content_Types].xml");
  let nextSlideNumber = maxExistingSlideNumber(zip) + 1;
  let nextRelationshipId = maxRelationshipId(relsXml) + 1;
  let nextSlideId = maxPresentationSlideId(presentationXml) + 1;
  const slideIdTags: string[] = [];
  const relationshipTags: string[] = [];
  const contentTypeTags: string[] = [];

  for (const diagnosticSlide of diagnosticSlides) {
    const slideNumber = nextSlideNumber++;
    const relationshipId = `rId${nextRelationshipId++}`;

    zip[`ppt/slides/slide${slideNumber}.xml`] = strToU8(
      buildDiagnosticSlideXml(diagnosticSlide),
    );
    zip[`ppt/slides/_rels/slide${slideNumber}.xml.rels`] = strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
    );
    slideIdTags.push(
      `<p:sldId id="${nextSlideId++}" r:id="${relationshipId}"/>`,
    );
    relationshipTags.push(
      `<Relationship Id="${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${slideNumber}.xml"/>`,
    );
    contentTypeTags.push(
      `<Override PartName="/ppt/slides/slide${slideNumber}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
    );
  }

  presentationXml = presentationXml.replace(
    "</p:sldIdLst>",
    `${slideIdTags.join("")}</p:sldIdLst>`,
  );
  relsXml = relsXml.replace(
    "</Relationships>",
    `${relationshipTags.join("")}</Relationships>`,
  );
  contentTypesXml = contentTypesXml.replace(
    "</Types>",
    `${contentTypeTags.join("")}</Types>`,
  );

  writeZipText(zip, presentationPath, presentationXml);
  writeZipText(zip, relsPath, relsXml);
  writeZipText(zip, "[Content_Types].xml", contentTypesXml);
}

function buildDiagnosticSlides(plan: MayaDeckPlan) {
  return [
    {
      bullets: plan.diagnosticOutline.slice(0, 5),
      kicker: "Part 4",
      title: `Preliminary Diagnostic - ${plan.brief.clientName}`,
    },
    {
      bullets: buildUseCaseBullets(plan),
      kicker: "Use cases to pressure-test",
      title: "Premiers cas d'usage à explorer",
    },
  ].filter((slide) => slide.bullets.length > 0);
}

function buildUseCaseBullets(plan: MayaDeckPlan) {
  if (plan.useCaseBullets?.length) {
    return plan.useCaseBullets.slice(0, 6);
  }

  const context = normalize(
    [
      plan.brief.clientName,
      plan.brief.clientType,
      plan.brief.industry,
      plan.brief.crmContext,
    ]
      .filter(Boolean)
      .join(" "),
  );
  const bullets = [
    "Assistant knowledge base pour capitaliser les savoirs internes et accélérer les équipes.",
    "Automatisation des workflows administratifs et back-office à fort volume.",
    "Copilote commercial pour préparer les meetings, relances et propositions.",
  ];

  if (
    includesAny(context, ["llm", "mistral", "local", "rag", "knowledge base"])
  ) {
    bullets.unshift(
      "Layer RAG / agentique sur le LLM local pour connecter documents, règles métier et actions opérationnelles.",
    );
  }

  if (includesAny(context, ["portfolio", "fonds", "private equity"])) {
    bullets.unshift(
      "Scoring du portefeuille pour prioriser les participations avec le meilleur ROI IA.",
    );
  }

  if (includesAny(context, ["groupe", "filiales", "holding"])) {
    bullets.unshift(
      "Radar groupe pour identifier les synergies data et les use cases mutualisables entre filiales.",
    );
  }

  if (
    includesAny(context, [
      "paiement",
      "payment",
      "monetique",
      "switch",
      "finance",
      "assurance",
    ])
  ) {
    bullets.unshift(
      "Détection d'anomalies, scoring de risque et assistance aux opérations financières.",
    );
  }

  if (
    includesAny(context, [
      "logistics",
      "supply",
      "industrial",
      "retail",
      "stock",
      "energie",
    ])
  ) {
    bullets.unshift(
      "Optimisation supply, prévision de demande et copilote d'exploitation terrain.",
    );
  }

  return bullets.slice(0, 6);
}

function buildDiagnosticSlideXml({
  bullets,
  kicker,
  title,
}: {
  bullets: string[];
  kicker: string;
  title: string;
}) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:bg><p:bgPr><a:solidFill><a:srgbClr val="F7F8FA"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      ${textShapeXml({ color: "008C89", fontSize: 1500, height: 330000, id: 2, text: kicker, width: 8400000, x: 760000, y: 520000 })}
      ${textShapeXml({ bold: true, color: "43536A", fontSize: 3600, height: 940000, id: 3, text: title, width: 9900000, x: 760000, y: 870000 })}
      ${bulletShapeXml({ bullets, id: 4, width: 10300000, x: 930000, y: 2050000 })}
      ${textShapeXml({ color: "778196", fontSize: 1200, height: 300000, id: 5, text: "Draft généré par Maya depuis le CRM et le deck générique Qarizmi.", width: 7600000, x: 760000, y: 6200000 })}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

function textShapeXml({
  bold = false,
  color,
  fontSize,
  height,
  id,
  text,
  width,
  x,
  y,
}: {
  bold?: boolean;
  color: string;
  fontSize: number;
  height: number;
  id: number;
  text: string;
  width: number;
  x: number;
  y: number;
}) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${width}" cy="${height}"/></a:xfrm></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/><a:p><a:r><a:rPr lang="fr-FR" sz="${fontSize}"${bold ? ' b="1"' : ""}><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Inter"/></a:rPr><a:t>${escapeXml(text)}</a:t></a:r></a:p></p:txBody></p:sp>`;
}

function bulletShapeXml({
  bullets,
  id,
  width,
  x,
  y,
}: {
  bullets: string[];
  id: number;
  width: number;
  x: number;
  y: number;
}) {
  const paragraphXml = bullets
    .map(
      (bullet) =>
        `<a:p><a:pPr marL="285750" indent="-171450"><a:buChar char="•"/></a:pPr><a:r><a:rPr lang="fr-FR" sz="1850"><a:solidFill><a:srgbClr val="43536A"/></a:solidFill><a:latin typeface="Inter"/></a:rPr><a:t>${escapeXml(bullet)}</a:t></a:r></a:p>`,
    )
    .join("");

  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Bullets ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${width}" cy="3750000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>${paragraphXml}</p:txBody></p:sp>`;
}

function parseSlideRelationships(relsXml: string) {
  return Array.from(relsXml.matchAll(/<Relationship\b[^>]*\/>/g))
    .map((match) => {
      const tag = match[0];
      const target = getXmlAttribute(tag, "Target");
      const id = getXmlAttribute(tag, "Id");
      const type = getXmlAttribute(tag, "Type");
      const slideMatch = target?.match(/^slides\/slide(\d+)\.xml$/);

      return id && target && type?.endsWith("/slide") && slideMatch?.[1]
        ? { id, slideNumber: Number(slideMatch[1]) }
        : null;
    })
    .filter(
      (relationship): relationship is { id: string; slideNumber: number } =>
        Boolean(relationship),
    );
}

function maxExistingSlideNumber(zip: Record<string, Uint8Array>) {
  return Math.max(
    0,
    ...Object.keys(zip)
      .map((entryPath) => entryPath.match(/^ppt\/slides\/slide(\d+)\.xml$/))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => Number(match[1])),
  );
}

function maxRelationshipId(relsXml: string) {
  return Math.max(
    0,
    ...Array.from(relsXml.matchAll(/\brId(\d+)\b/g)).map((match) =>
      Number(match[1]),
    ),
  );
}

function maxPresentationSlideId(presentationXml: string) {
  return Math.max(
    256,
    ...Array.from(presentationXml.matchAll(/<p:sldId\b[^>]*\bid="(\d+)"/g)).map(
      (match) => Number(match[1]),
    ),
  );
}

function getXmlAttribute(tag: string, attributeName: string) {
  const match = tag.match(
    new RegExp(`\\b${escapeRegExp(attributeName)}="([^"]*)"`),
  );
  return match?.[1] ?? null;
}

function readZipText(zip: Record<string, Uint8Array>, entryPath: string) {
  const entry = zip[entryPath];
  if (!entry) {
    throw new Error(`PPTX entry not found: ${entryPath}`);
  }
  return strFromU8(entry);
}

function writeZipText(
  zip: Record<string, Uint8Array>,
  entryPath: string,
  value: string,
) {
  zip[entryPath] = strToU8(value);
}

function includesAny(value: string, needles: string[]) {
  return needles.some((needle) => value.includes(needle));
}

function normalize(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("fr-FR")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
