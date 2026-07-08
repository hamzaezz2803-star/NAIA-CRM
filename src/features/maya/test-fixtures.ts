import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { strToU8, zipSync } from "fflate";

const genericDeckFileName =
  "Qarizmi_Introduction_Service as a software_Generic.pptx";
const exampleDeckFileNames = [
  "20260609_Qarizmi_Introduction_Service as a software_Econosol.pptx",
  "20260611_Qarizmi_Introduction_Service as a software_ODM.pptx",
  "20260701_Qarizmi_Introduction_Service as a software_SPE portfolio.pptx",
  "20260706_Qarizmi_Introduction_Service as a software_Permis a point.pptx",
  "20260707_Qarizmi_Introduction_Service as a software_AKWA.pptx",
];

export async function createMayaPitchDeckFixture(rootPath: string) {
  await mkdir(rootPath, { recursive: true });
  await createPptxFile(
    path.join(rootPath, genericDeckFileName),
    buildGenericSlideTexts(),
  );

  for (const fileName of exampleDeckFileNames) {
    await createPptxFile(
      path.join(rootPath, fileName),
      buildExampleSlideTexts(fileName),
    );
  }

  return {
    genericDeckFileName,
    rootPath,
  };
}

function buildGenericSlideTexts() {
  return Array.from({ length: 44 }, (_, index) => {
    const slideNumber = index + 1;

    if (slideNumber <= 9) return `Présentation Qarizmi slide ${slideNumber}`;
    if (slideNumber <= 14) return `Offre Qarizmi slide ${slideNumber}`;
    if (slideNumber === 16) return "Credentials Healthcare patient clinique";
    if (slideNumber === 17) return "Healthcare laboratory pharma credential";
    if (slideNumber === 20) return "Financial Services payment scoring";
    if (slideNumber === 21) return "Financial services assurance credit";
    if (slideNumber === 25) return "Industrials logistics supply chain";
    if (slideNumber === 26) return "Retail energy stations stocks";
    if (slideNumber === 44) return "Next steps session de questions";

    return `Credentials generic case study slide ${slideNumber}`;
  });
}

function buildExampleSlideTexts(fileName: string) {
  const client = fileName.includes("AKWA") ? "AKWA" : "Example";
  return Array.from({ length: 22 }, (_, index) => {
    const slideNumber = index + 1;
    if (slideNumber <= 9) return `${client} présentation ${slideNumber}`;
    if (slideNumber <= 14) return `${client} offre ${slideNumber}`;
    if (slideNumber <= 20) return `${client} credentials ${slideNumber}`;
    if (fileName.includes("AKWA")) {
      return "Préliminary diagnostic AKWA premier groupe marocain piloté par la donnée";
    }
    return `${client} preliminary diagnostic ${slideNumber}`;
  });
}

async function createPptxFile(filePath: string, slideTexts: string[]) {
  const zip: Record<string, Uint8Array> = {};
  const slideIds = slideTexts
    .map(
      (_text, index) => `<p:sldId id="${500 + index}" r:id="rId${index + 1}"/>`,
    )
    .join("");
  const relationships = slideTexts
    .map(
      (_text, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`,
    )
    .join("");
  const contentTypes = slideTexts
    .map(
      (_text, index) =>
        `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
    )
    .join("");

  zip["[Content_Types].xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>${contentTypes}</Types>`,
  );
  zip["ppt/presentation.xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
  );
  zip["ppt/_rels/presentation.xml.rels"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}</Relationships>`,
  );

  for (const [index, text] of slideTexts.entries()) {
    zip[`ppt/slides/slide${index + 1}.xml`] = strToU8(buildSlideXml(text));
  }

  await writeFile(filePath, Buffer.from(zipSync(zip, { level: 6 })));
}

function buildSlideXml(text: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Text"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${escapeXml(text)}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
