import type { MayaExtractedSlide, MayaLearningEvent } from "./contracts";

export function compareMayaPitchDecks({
  draft,
  final,
}: {
  draft: MayaExtractedSlide[];
  final: MayaExtractedSlide[];
}) {
  const events: MayaLearningEvent[] = [];
  const finalByNumber = new Map(
    final.map((slide) => [slide.slideNumber, slide]),
  );
  const draftByNumber = new Map(
    draft.map((slide) => [slide.slideNumber, slide]),
  );

  for (const draftSlide of draft) {
    const finalSlide = finalByNumber.get(draftSlide.slideNumber);
    if (!finalSlide) {
      events.push({
        beforeExcerpt: excerpt(draftSlide.text),
        eventType: "slide_removed",
        summary: `Nabil removed slide ${draftSlide.slideNumber}: ${draftSlide.title}.`,
        weight: 1,
      });
      continue;
    }

    if (textSimilarity(draftSlide.text, finalSlide.text) < 0.45) {
      events.push({
        afterExcerpt: excerpt(finalSlide.text),
        beforeExcerpt: excerpt(draftSlide.text),
        eventType: "copy_changed",
        summary: `Nabil rewrote slide ${draftSlide.slideNumber}: ${draftSlide.title}.`,
        weight: 1,
      });
    }
  }

  for (const finalSlide of final) {
    if (draftByNumber.has(finalSlide.slideNumber)) continue;
    events.push({
      afterExcerpt: excerpt(finalSlide.text),
      eventType: "slide_added",
      summary: `Nabil added slide ${finalSlide.slideNumber}: ${finalSlide.title}.`,
      weight: 1,
    });
  }

  return events;
}

export function summarizeMayaLearningEvents(events: MayaLearningEvent[]) {
  return events
    .slice(0, 5)
    .map((event) => event.summary)
    .join(" ")
    .slice(0, 280);
}

function textSimilarity(left: string, right: string) {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  if (leftTokens.size === 0 && rightTokens.size === 0) return 1;

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }

  return intersection / new Set([...leftTokens, ...rightTokens]).size;
}

function tokenSet(value: string) {
  return new Set(
    value
      .normalize("NFKD")
      .replace(/\p{Diacritic}/gu, "")
      .toLocaleLowerCase("fr-FR")
      .split(/[^a-z0-9]+/i)
      .filter((token) => token.length > 2),
  );
}

function excerpt(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 500);
}
