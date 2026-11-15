import SetupPage from "../SetupPage";

export const instant = false;

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <SetupPage slug={slug} />;
}
