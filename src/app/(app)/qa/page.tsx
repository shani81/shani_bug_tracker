import { getTestPlans } from "@/lib/module-queries";
import { PageHeader, PageContainer } from "@/components/page-header";
import { QAView } from "@/components/modules/qa-view";

export default async function QAPage() {
  const plans = await getTestPlans();

  return (
    <PageContainer>
      <PageHeader icon={"🧪"} title="QA Testing" subtitle="Test plans, cases and execution results" />
      <QAView plans={plans} />
    </PageContainer>
  );
}
