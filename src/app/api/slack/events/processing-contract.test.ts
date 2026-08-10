import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const route = readFileSync(
  resolve(process.cwd(), "src/app/api/slack/events/route.ts"),
  "utf8",
);

describe("Slack event processing lease contract", () => {
  it("keeps processing read-only until the publish fence", () => {
    const processingStart = route.indexOf("async function handleSlackCommand");
    const fenceWrapperStart = route.indexOf(
      "async function postLeasedSlackEventMessage",
    );
    const processing = route.slice(processingStart, fenceWrapperStart);

    expect(processingStart).toBeGreaterThan(-1);
    expect(fenceWrapperStart).toBeGreaterThan(processingStart);
    expect(processing).not.toMatch(
      /\b(?:create|delete|execute|update)[A-Z][A-Za-z0-9_]*\s*\(/,
    );
    expect(processing).not.toContain("postSlackMessage(");
  });

  it("allows exactly one raw Slack post and places it after the CAS fence", () => {
    const beginFence = route.indexOf('"begin_slack_event_publish"');
    const rawPost = route.indexOf("await postSlackMessage(message)");

    expect(route.match(/postSlackMessage\(/g)).toHaveLength(1);
    expect(beginFence).toBeGreaterThan(-1);
    expect(rawPost).toBeGreaterThan(beginFence);
  });
});
