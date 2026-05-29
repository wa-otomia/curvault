//! Event-driven reader/card monitor using native PC/SC — no polling.
//!
//! A dedicated thread runs `SCardGetStatusChange`, which blocks inside the
//! PC/SC daemon and only returns when a reader is added/removed or a card is
//! inserted/removed (or after a long safety timeout). On every change we emit
//! `pcsc://changed`; the frontend re-reads the reader list then. The card is
//! therefore powered (ATR probe) only when something actually changes —
//! never on a timer, which is far friendlier to contactless cards/readers.
//!
//! `SCardGetStatusChange` itself does NOT power the card; it reports presence
//! at the resource-manager level, so the wait is essentially free.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use pcsc::{Context, Error, ReaderState, Scope, State, PNP_NOTIFICATION};
use tauri::{AppHandle, Emitter, Runtime};

static ACTIVE: AtomicBool = AtomicBool::new(false);

/// Whether the native monitor is running. The frontend polls as a fallback
/// only when this is false.
pub fn is_active() -> bool {
    ACTIVE.load(Ordering::Relaxed)
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
            // Tell the frontend to resume polling.
            let _ = app.emit("pcsc://stopped", ());
        });
}

fn is_dead(rs: &ReaderState) -> bool {
    rs.event_state().intersects(State::UNKNOWN | State::IGNORE)
}

fn watch_loop<R: Runtime>(ctx: &Context, app: &AppHandle<R>) -> Result<(), Error> {
    let mut readers_buf = [0u8; 4096];
    // The PnP pseudo-reader makes get_status_change wake on reader hotplug.
    let mut states: Vec<ReaderState> =
        vec![ReaderState::new(PNP_NOTIFICATION(), State::UNAWARE)];

    loop {
        // Drop readers that vanished.
        states.retain(|rs| rs.name() == PNP_NOTIFICATION() || !is_dead(rs));

        // Add readers that appeared.
        match ctx.list_readers(&mut readers_buf) {
            Ok(names) => {
                for name in names {
                    if !states.iter().any(|rs| rs.name() == name) {
                        states.push(ReaderState::new(name, State::UNAWARE));
                    }
                }
            }
            // No readers yet — keep waiting on the PnP pseudo-reader.
            Err(Error::NoReadersAvailable) => {}
            Err(e) => return Err(e),
        }

        // Adopt the current event states as the baseline to diff against.
        for rs in &mut states {
            rs.sync_current_state();
        }

        // Block until something changes (first call returns immediately with
        // the real state, which serves as the initial signal). The 60s
        // timeout is only a safety re-arm; real changes return instantly.
        match ctx.get_status_change(Some(Duration::from_secs(60)), &mut states) {
            Ok(()) => {
                let _ = app.emit("pcsc://changed", ());
            }
            Err(Error::Timeout) => { /* re-list and re-arm */ }
            Err(e) => return Err(e),
        }
    }
}
