// Native browser dialogs (window.confirm / window.prompt / window.alert)
// do NOT work reliably inside Tauri's webview — on macOS WKWebView
// confirm() returns true immediately without showing anything and
// prompt() returns null. Every destructive action MUST go through the
// Tauri dialog plugin instead.

import { confirm as tauriConfirm, message as tauriMessage } from "@tauri-apps/plugin-dialog";

export async function confirmAction(
  msg: string,
  opts?: { title?: string; danger?: boolean; okLabel?: string },
): Promise<boolean> {
  return tauriConfirm(msg, {
    title: opts?.title ?? "Please confirm",
    kind: opts?.danger ? "warning" : "info",
    okLabel: opts?.okLabel ?? (opts?.danger ? "Proceed" : "OK"),
    cancelLabel: "Cancel",
  });
}

export async function showMessage(
  msg: string,
  opts?: { title?: string; kind?: "info" | "warning" | "error" },
): Promise<void> {
  await tauriMessage(msg, {
    title: opts?.title ?? "Curvault",
    kind: opts?.kind ?? "info",
  });
}
