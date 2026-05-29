//! Event-driven reader/card monitor using native PC/SC — no polling, and no
//! repeated card power-ups.
//!
//! A dedicated thread runs `SCardGetStatusChange`, which blocks inside the
//! PC/SC daemon and only returns when a reader is added/removed or a card is
//! inserted/removed. `SCardGetStatusChange` does NOT power the card — and it
//! hands us the cold ATR the resource manager captured at insertion. So we
//! can report presence (and whether the card is usable) straight from the
//! status change, WITHOUT shelling out to `opensc-tool -an` (which powers the
//! card and makes contactless readers blink on every check).
//!
//! Each change emits a `pcsc://readers` event carrying the reader snapshot;
//! the frontend consumes it directly. The card is then only powered when the
//! user actually inspects or operates on it.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use pcsc::{Context, Error, ReaderState, Scope, State, PNP_NOTIFICATION};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

static ACTIVE: AtomicBool = AtomicBool::new(false);
static LAST: Mutex<Option<Vec<ReaderSnapshot>>> = Mutex::new(None);

#[derive(Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderSnapshot {
    pub name: String,
    /// A card that the resource manager could power (has an ATR). A latched /
    /// mute contactless reader reports PRESENT but yields no ATR, so it reads
    /// as no card — matching the active-probe behaviour, but without powering.
    pub has_card: bool,
    pub atr: Option<String>,
}

/// Whether the native monitor is running. The frontend polls as a fallback
/// only when this is false.
pub fn is_active() -> bool {
    ACTIVE.load(Ordering::Relaxed)
}

/// Latest reader snapshot the monitor observed (None until the first change,
/// or if the monitor never started). Reads cached state only — never touches
/// a card.
pub fn last_snapshot() -> Option<Vec<ReaderSnapshot>> {
    LAST.lock().ok().and_then(|g| g.clone())
}

/// Try to start the monitor. Call once at setup. If PC/SC is unavailable the
/// function returns quietly and the frontend keeps polling.
pub fn start<R: Runtime>(app: AppHandle<R>) {
    let ctx = match Context::establish(Scope::User) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("PC/SC monitor unavailable ({e}); UI will fall back to polling.");
            return;
        }
    };
    ACTIVE.store(true, Ordering::Relaxed);
    let _ = std::thread::Builder::new()
        .name("pcsc-monitor".into())
        .spawn(move || {
            let result = watch_loop(&ctx, &app);
            ACTIVE.store(false, Ordering::Relaxed);
            if let Err(e) = result {
                eprintln!("PC/SC monitor stopped: {e}");
            }
            let _ = app.emit("pcsc://stopped", ());
        });
}

fn is_dead(rs: &ReaderState) -> bool {
    rs.event_state().intersects(State::UNKNOWN | State::IGNORE)
}

fn snapshot(states: &[ReaderState]) -> Vec<ReaderSnapshot> {
    states
        .iter()
        .filter(|rs| rs.name() != PNP_NOTIFICATION())
        .map(|rs| {
            let atr = rs.atr();
            let present = rs.event_state().contains(State::PRESENT) && !atr.is_empty();
            ReaderSnapshot {
                name: rs.name().to_string_lossy().into_owned(),
                has_card: present,
                atr: if atr.is_empty() {
                    None
                } else {
                    Some(
                        atr.iter()
                            .map(|b| format!("{b:02x}"))
                            .collect::<Vec<_>>()
                            .join(":"),
                    )
                },
            }
        })
        .collect()
}

fn watch_loop<R: Runtime>(ctx: &Context, app: &AppHandle<R>) -> Result<(), Error> {
    let mut readers_buf = [0u8; 4096];
    let mut states: Vec<ReaderState> =
        vec![ReaderState::new(PNP_NOTIFICATION(), State::UNAWARE)];

    loop {
        states.retain(|rs| rs.name() == PNP_NOTIFICATION() || !is_dead(rs));

        match ctx.list_readers(&mut readers_buf) {
            Ok(names) => {
                for name in names {
                    if !states.iter().any(|rs| rs.name() == name) {
                        states.push(ReaderState::new(name, State::UNAWARE));
                    }
                }
            }
            Err(Error::NoReadersAvailable) => {}
            Err(e) => return Err(e),
        }

        for rs in &mut states {
            rs.sync_current_state();
        }

        match ctx.get_status_change(Some(Duration::from_secs(60)), &mut states) {
            Ok(()) => {
                let snap = snapshot(&states);
                // Emit only on a real change so a flickering reader can't
                // spam events (and we never power the card to find out).
                let changed = {
                    let guard = LAST.lock().unwrap();
                    guard.as_ref() != Some(&snap)
                };
                if changed {
                    *LAST.lock().unwrap() = Some(snap.clone());
                    let _ = app.emit("pcsc://readers", &snap);
                } else {
                    // Same state but the daemon woke us — back off briefly so a
                    // pathological reader can't spin this thread.
                    std::thread::sleep(Duration::from_millis(400));
                }
            }
            Err(Error::Timeout) => { /* re-list and re-arm */ }
            Err(e) => return Err(e),
        }
    }
}
