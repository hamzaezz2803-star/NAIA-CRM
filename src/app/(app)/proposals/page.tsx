import { fetchMayaPitchQueueAction } from "@/features/maya/actions";
import { MayaPitchQueue } from "@/features/maya/maya-pitch-queue";

export default async function ProposalsPage() {
  const result = await fetchMayaPitchQueueAction();

  return <MayaPitchQueue result={result} />;
}
