import { describe, expect, it } from "vitest";

import {
  type MeetingKnowledgeOutputRow,
  selectLatestMeetingOutputRows,
} from "./knowledge";

describe("meeting knowledge source selection", () => {
  it("keeps exactly the latest output version for every recent meeting", () => {
    const rows = [
      output("meeting-a", 1, "a-v1"),
      output("meeting-b", 1, "b-v1"),
      output("meeting-a", 3, "a-v3"),
      output("meeting-b", 2, "b-v2"),
      output("meeting-a", 2, "a-v2"),
      output("meeting-c", 1, "c-v1"),
    ];

    expect(selectLatestMeetingOutputRows(rows).map((row) => row.id)).toEqual([
      "a-v3",
      "b-v2",
      "c-v1",
    ]);
  });
});

function output(
  meetingId: string,
  version: number,
  id: string,
): MeetingKnowledgeOutputRow {
  return {
    id,
    meeting_id: meetingId,
    notes_markdown: `Notes ${id}`,
    version,
  };
}
