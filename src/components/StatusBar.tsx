import { useEffect, useState } from "react";
import { listReaders } from "../lib/api";

// Refresh policy: one-shot on mount. Polling every few seconds floods the
// command log with noise and rarely surfaces a real state change — readers
// don't appear / disappear that often. The Readers view has its own
// explicit Refresh button for when the user actually wants to recheck.
export default function StatusBar() {
  const [readerCount, setReaderCount] = useState<number | null>(null);
  const [cardCount, setCardCount] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    listReaders()
      .then((readers) => {
        setReaderCount(readers.length);
        setCardCount(readers.filter((r) => r.hasCard).length);
        setErr(null);
      })
      .catch((e: unknown) => setErr(String(e)));
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
      <span>Curvault · v0.1.8</span>
    </div>
  );
}
