import { PageBody, PageHeader } from "@/components/layout/Page";
import { MFG } from "@/lib/menu";

// 🏭 MANUFACTURING pages (Scheduling & Work Order · Kanban · Product Structure (BOM)): header only until each page is built
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const item = MFG.menu.find((m) => m.href === `/mfg/${slug}`);
  return (
    <PageBody>
      <PageHeader icon={item?.icon ?? MFG.icon} title={item?.label ?? "MANUFACTURING"} subtitle="MANUFACTURING • MES" />
    </PageBody>
  );
}
