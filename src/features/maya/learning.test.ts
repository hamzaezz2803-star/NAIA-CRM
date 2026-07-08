import { describe, expect, it } from "vitest";

import type { MayaExtractedSlide } from "./contracts";
import { compareMayaPitchDecks, summarizeMayaLearningEvents } from "./learning";

describe("Maya pitch learning", () => {
  it("detects removed, added and rewritten slides", () => {
    const draft = [
      makeSlide(1, "Présentation Qarizmi"),
      makeSlide(2, "Credential healthcare"),
      makeSlide(3, "Diagnostic: generic use cases for payments"),
    ];
    const final = [
      makeSlide(1, "Présentation Qarizmi"),
      makeSlide(
        3,
        "Diagnostic: HPS should focus on payment orchestration and LLM support workflows",
      ),
      makeSlide(4, "Roadmap: quick wins then platform scale-up"),
    ];

    const events = compareMayaPitchDecks({ draft, final });

    expect(events.map((event) => event.eventType)).toContain("slide_removed");
    expect(events.map((event) => event.eventType)).toContain("slide_added");
    expect(events.map((event) => event.eventType)).toContain("copy_changed");
    expect(
      events.every((event) => (event.afterExcerpt?.length ?? 0) <= 500),
    ).toBe(true);
  });

  it("summarizes without exposing full raw deck text", () => {
    const summary = summarizeMayaLearningEvents([
      {
        afterExcerpt: "A".repeat(600),
        eventType: "copy_changed",
        summary: "Nabil rewrote the diagnostic.",
        weight: 1,
      },
    ]);

    expect(summary).toContain("Nabil rewrote the diagnostic.");
    expect(summary.length).toBeLessThan(300);
  });
});

function makeSlide(slideNumber: number, text: string): MayaExtractedSlide {
  return {
    section: "diagnostic",
    slideNumber,
    sourceHash: `${slideNumber}-${text.length}`,
    text,
    title: text.slice(0, 32),
  };
}
