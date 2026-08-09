export type MeetingKnowledgeOutputRow = {
  created_at?: string;
  id: string;
  meeting_id: string;
  notes_markdown: string;
  reviewed_notes_markdown?: string | null;
  transcript_text?: string | null;
  version: number;
};

export function selectLatestMeetingOutputRows(
  rows: MeetingKnowledgeOutputRow[],
) {
  const latestByMeeting = new Map<string, MeetingKnowledgeOutputRow>();
  for (const row of rows) {
    const current = latestByMeeting.get(row.meeting_id);
    if (
      !current ||
      row.version > current.version ||
      (row.version === current.version &&
        (row.created_at ?? "") > (current.created_at ?? ""))
    ) {
      latestByMeeting.set(row.meeting_id, row);
    }
  }
  return [...latestByMeeting.values()];
}
