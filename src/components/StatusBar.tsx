import { useEffect, useState } from "react";
import { listReadersQuiet } from "../lib/api";

// The status bar polls every few seconds so the reader / card counts
// stay in sync with what's physically plugged in. It uses the *quiet*
// reader listing, which skips ATR reads and does NOT emit command-log
// entries — so the poll never floods the bottom panel.
const POLL_MS = 3000;

export default function StatusBar() {
  const [readerCount, setReaderCount] = useState<number | null>(null);
  const [cardCount, setCardCount] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const readers = await listReadersQuiet();
        if (!alive) return;
        setReaderCount(readers.length);
        setCardCount(readers.filter((r) => r.hasCard).length);
        setErr(null);
      } catch (e: unknown) {
        if (alive) setErr(String(e));
      }
    };
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="statusbar">
      <span>
        {err ? (
          <>
            <span className="dot error" />
            {err}
          </>
        ) : (
          <>
            <span className={`dot ${(cardCount ?? 0) > 0 ? "ok" : "warn"}`} />
            {readerCount ?? "—"} reader{readerCount === 1 ? "" : "s"},{" "}
            {cardCount ?? "—"} card{cardCount === 1 ? "" : "s"} present
          </>
        )}
      </span>
      <span>Curvault · v0.1.17</span>
    </div>
  );
}
