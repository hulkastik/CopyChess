import SpectatorBoard from "@/components/SpectatorBoard";
import PageHeader from "@/components/PageHeader";

export default async function WatchPage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;

  return (
    <main className="flex min-h-screen flex-col items-center px-3 py-4 sm:px-6 sm:py-6">
      <PageHeader title="Zuschauen" hint={gameId.slice(0, 8)} />
      <SpectatorBoard gameId={gameId} />
    </main>
  );
}
