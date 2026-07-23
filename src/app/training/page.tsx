import TrainingBoard from "@/components/TrainingBoard";
import PageHeader from "@/components/PageHeader";

export default function TrainingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center px-3 py-4 sm:px-6 sm:py-6">
      <PageHeader title="🤖 Training vs. Stockfish" />
      <TrainingBoard />
    </main>
  );
}
