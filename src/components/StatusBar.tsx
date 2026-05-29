import { useCardWatch } from "../lib/cardWatch";

// The status bar reflects the shared card-presence watcher (see
// lib/cardWatch). It does not poll on its own — there is a single PC/SC
// poll for the whole app, and card-data views react to the same signal.
export default function StatusBar() {
  const { readers, cardPresent, ready, error } = useCardWatch();
  const readerCount = readers.length;
  const cardCount = readers.filter((r) => r.hasCard).length;

  return (
    <div className="statusbar">
      <span>
        {error ? (
          <>
            <span className="dot error" />
            {error}
          </>
        ) : (
          <>
            <span className={`dot ${cardPresent ? "ok" : "warn"}`} />
            {ready ? readerCount : "—"} reader{readerCount === 1 ? "" : "s"},{" "}
            {ready ? cardCount : "—"} card{cardCount === 1 ? "" : "s"} present
          </>
        )}
      </span>
      <span>Curvault · v0.1.28</span>
    </div>
  );
}
