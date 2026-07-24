import { notFound } from "next/navigation";
import { getIssueDetail } from "@/lib/queries";
import { IssueDetail } from "@/components/issues/detail/issue-detail";

export default async function IssuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const issue = await getIssueDetail(id);
  if (!issue) notFound();
  return <IssueDetail issue={issue} />;
}
