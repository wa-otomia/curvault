import { useEffect, useRef, useState } from "react";
import { onCommandLog, type CommandLogEntry } from "../lib/api";

const MAX_ENTRIES = 300;

export default function LogPanel() {
  const [entries, setEntries] = useState<CommandLogEntry[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let unsub = () => {};
    onCommandLog((e) => {
      setEntries((prev) => {
        const next = [...prev, e];
        if (next.length > MAX_ENTRIES) next.splice(0, next.length - MAX_ENTRIES);
        return next;
      });
    }).then((u) => { unsub = u; });
    return () => unsub();
  }, []);

  // Auto-scroll to newest entry when expanded.
  useEffect(() => {
    if (expanded && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [entries, expanded]);

  return (
    <div className={`logpanel ${expanded ? "expanded" : "collapsed"}`}>
      <div className="logpanel-header" onClick={() => setExpanded(!expanded)}>
        <span className="chevron" />
        <span>Command log</span>
        <span style={{ marginLeft: "auto" }}>{entries.length} entries</span>
        {entries.length > 0 && (
          <button
            style={{ padding: "0 0.5rem", fontSize: 11 }}
            onClick={(e) => { e.stopPropagation(); setEntries([]); setOpenId(null); }}
          >
            Clear
          </button>
        )}
      </div>
      {expanded && (
        <div className="logpanel-list" ref={listRef}>
          {entries.length === 0 ? (
            <div className="empty" style={{ padding: "0.5rem 0" }}>
              No commands logged yet. Trigger a backend action.
            </div>
          ) : (
            entries.map((e) => {
              const ts = new Date(e.startedAt).toLocaleTimeString();
              const isOpen = openId === e.id;
              const isFail = e.exitCode !== 0 || !!e.error;
              return (
                <div
                  key={e.id}
                  className="logpanel-entry"
                  onClick={() => setOpenId(isOpen ? null : e.id)}
                >
                  <div className="head">
                    <span className="ts">{ts}</span>
                    <span className="prog">{e.program}</span>
                    <span className="args">{e.args.join(" ")}</span>
                    <span className={`exit ${isFail ? "fail" : "ok"}`}>
                      {e.error ? "ERR" : `exit ${e.exitCode}`}
                    </span>
                    <span className="dur">{e.durationMs} ms</span>
                  </div>
                  {isOpen && (
                    <div className="body">
                      {e.error && <div style={{ color: "var(--error)" }}>error: {e.error}</div>}
                      {e.stdout && <><strong>stdout:</strong>{"\n"}{e.stdout}{"\n"}</>}
                      {e.stderr && <><strong>stderr:</strong>{"\n"}{e.stderr}</>}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
