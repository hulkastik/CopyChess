import AnalysisBoard from "@/components/AnalysisBoard";
import PageHeader from "@/components/PageHeader";

/**
 * Analyse einer nicht gespeicherten Partie (Training, lokales Spiel).
 * Die Zugliste kommt aus dem sessionStorage, nicht aus der Datenbank.
 *
 * Statisches Segment — geht damit dem dynamischen `/analyse/[gameId]` vor.
 */
export default function AnalyseSessionPage() {
  return (
    <main className="flex min-h-screen flex-col items-center px-3 py-4 sm:px-6 sm:py-6">
      <PageHeader title="Partieanalyse" hint="← → zum Blättern" />
      <AnalysisBoard />
    </main>
  );
}
