import ProfileView from "@/components/ProfileView";
import PageHeader from "@/components/PageHeader";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;

  return (
    <main className="flex min-h-screen flex-col items-center px-3 py-4 sm:px-6 sm:py-6">
      <PageHeader title="Profil" />
      <ProfileView userId={userId} />
    </main>
  );
}
