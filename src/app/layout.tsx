import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import FriendsSidebar from "@/components/FriendsSidebar";

export const metadata: Metadata = {
  title: "Chess",
  description: "Schach gegen Freunde, gegen Stockfish, mit Partieanalyse",
  manifest: "/manifest.webmanifest",
  applicationName: "Chess",
  appleWebApp: {
    // Vom Homescreen gestartet laeuft die Seite ohne Safari-Leisten.
    capable: true,
    title: "Chess",
    statusBarStyle: "black-translucent",
  },
  // Telefonnummern-Erkennung wuerde Zugnotation wie "1. e4" verlinken.
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Zoom bleibt erlaubt (Zugänglichkeit), aber Doppeltipp-Zoom stoert das
  // Ziehen von Figuren nicht mehr, weil das Brett touch-action selbst setzt.
  maximumScale: 5,
  themeColor: "#12141a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de">
      <body className="min-h-screen overflow-x-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
        <AuthProvider>
          <FriendsSidebar />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
