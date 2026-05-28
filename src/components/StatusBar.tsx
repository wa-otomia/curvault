import { useEffect, useState } from "react";
import { listReaders } from "../lib/api";

export default function StatusBar() {
  const [readerCount, setReaderCount] = useState<number | null>(null);
  const [cardCount, setCardCount] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const refresh = async () => {
      try {
        const readers = await listReaders();
        setReaderCount(readers.length);
        setCardCount(readers.filter((r) => r.hasCard).length);
        setErr(null);
      } catch (e: unknown) {
        setErr(String(e));
      }
    };
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
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
      <span>v0.1.0</span>
    </div>
  );
}
