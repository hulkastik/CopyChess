import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import FriendsSidebar from "@/components/FriendsSidebar";

export const metadata: Metadata = {
  title: "Chess App",
  description: "Play chess online – local, multiplayer, or vs AI",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de">
      <body className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
        <AuthProvider>
          <FriendsSidebar />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
