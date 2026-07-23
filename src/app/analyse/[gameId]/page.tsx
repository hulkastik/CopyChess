import AnalysisBoard from "@/components/AnalysisBoard";
import PageHeader from "@/components/PageHeader";

export default async function AnalysePage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;

  return (
    <main className="flex min-h-screen flex-col items-center px-3 py-4 sm:px-6 sm:py-6">
      <PageHeader title="Partieanalyse" hint="← → zum Blättern" />
      <AnalysisBoard gameId={gameId} />
    </main>
  );
}
