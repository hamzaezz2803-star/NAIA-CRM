import { fetchLeadsAction } from "@/features/crm/actions";
import { NaiaCommandCenter } from "@/features/naia/naia-command-center";

export default async function MeetingsPage() {
  const leads = await fetchLeadsAction();

  return (
    <NaiaCommandCenter
      initialCrmStats={{
        leadCount: leads.length,
        openLeadCount: leads.filter(
          (lead) => lead.status !== "won" && lead.status !== "dead-end",
        ).length,
      }}
    />
  );
}
