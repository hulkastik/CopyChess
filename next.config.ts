/** @type {import('next').NextConfig} */

/**
 * Adresse des Socket-Servers aus Sicht des Next-Prozesses. Beide laufen auf
 * derselben Maschine, deshalb localhost — das geht nie durch das Internet.
 *
 * Der Port wird aus `SOCKET_PORT` abgeleitet, damit derselbe Eintrag in der
 * .env den Spielserver UND diese Weiterleitung steuert. Zwei getrennte
 * Variablen waeren zwei Gelegenheiten, sie auseinanderlaufen zu lassen.
 *
 * Achtung: Weiterleitungen wertet Next beim BUILD aus. Wer den Port aendert,
 * muss neu bauen — ein Neustart allein genuegt nicht.
 */
// Bewusst OHNE Rueckfall auf `PORT`: das setzt pm2 fuer den Next-Prozess selbst.
// Eine Weiterleitung auf den eigenen Port waere eine Schleife.
const SOCKET_PORT = process.env.SOCKET_PORT || "3001";
const SOCKET_INTERNAL_URL =
  process.env.SOCKET_INTERNAL_URL || `http://localhost:${SOCKET_PORT}`;

const nextConfig = {
  reactStrictMode: true,

  /**
   * socket.io fragt `/socket.io/?EIO=4…` mit Schrägstrich an. Next würde daraus
   * per 308 `/socket.io?EIO=4…` machen — die Umleitung greift VOR der
   * Weiterleitung und kostet jede Abfrage einen zusätzlichen Umlauf. Ohne
   * dieses Flag scheitert der Verbindungsaufbau.
   */
  skipTrailingSlashRedirect: true,

  /**
   * Der Socket-Verkehr läuft über dieselbe Herkunft wie die Seite und wird von
   * Next an den Spielserver weitergereicht.
   *
   * Damit entfallen drei Fehlerquellen auf einen Schlag: die Adresse des
   * Spielservers muss nicht mehr im Browser-Bundle stehen, es gibt kein CORS
   * mehr, und der Tunnel braucht keine eigene Regel für `/socket.io/`. Zuvor
   * genügte eine falsche dieser drei Angaben, damit Online-Anzeige und
   * Herausforderungen lautlos nicht funktionierten.
   *
   * Weitergereicht wird der Polling-Transport. Den WebSocket-Aufstieg proxyt
   * Next nicht; socket.io bleibt dann einfach beim Polling. Für Züge und
   * Präsenz ist das völlig ausreichend. Wer den Aufstieg will, richtet im
   * Tunnel zusätzlich eine Regel für `/socket.io/` ein — dann greift die
   * zuerst und diese Weiterleitung wird gar nicht erst benutzt.
   */
  async rewrites() {
    return [
      // Der Handshake geht an `/socket.io/` ohne weiteren Pfad. Die Regel mit
      // `:path*` verliert bei leerem Pfad den Schrägstrich und trifft damit
      // `/socket.io`, worauf der Spielserver mit 404 antwortet — deshalb hier
      // zuerst die beiden exakten Formen.
      { source: "/socket.io", destination: `${SOCKET_INTERNAL_URL}/socket.io/` },
      { source: "/socket.io/", destination: `${SOCKET_INTERNAL_URL}/socket.io/` },
      {
        source: "/socket.io/:path*",
        destination: `${SOCKET_INTERNAL_URL}/socket.io/:path*`,
      },
    ];
  },
};

export default nextConfig;
