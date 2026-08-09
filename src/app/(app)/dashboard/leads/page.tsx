import { CrmPipelineClient } from "./crm-pipeline-client";
import { fetchCrmPipelineSnapshot } from "@/features/crm/pipeline-data";

export default async function LeadsPage() {
  const initialData = await fetchCrmPipelineSnapshot();

  return <CrmPipelineClient initialData={initialData} />;
}
