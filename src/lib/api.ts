// Single chokepoint for Tauri command invocations.
// Components import from here; never directly from @tauri-apps/api.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  Reader,
  CardInfo,
  GpKeyHandle,
  Profile,
  InstallParams,
  IssuanceReport,
  CommandResult,
} from "../types";

// ---------- Readers / Card ----------

export const listReaders = (): Promise<Reader[]> =>
  invoke("list_readers");

export const inspectCard = (reader: string): Promise<CardInfo> =>
  invoke("inspect_card", { reader });

// ---------- GP key vault ----------

export const listGpKeys = (): Promise<GpKeyHandle[]> =>
  invoke("list_gp_keys");

export const generateGpKey = (cardSerial?: string, note?: string): Promise<GpKeyHandle> =>
  invoke("generate_gp_key", { cardSerial, note });

export const deleteGpKey = (id: string): Promise<void> =>
  invoke("delete_gp_key", { id });

/** Atomically rotate a card's GP key from default to a fresh random one. */
export const lockGpKey = (reader: string, keyId: string): Promise<void> =>
  invoke("lock_gp_key", { reader, keyId });

// ---------- Applet management ----------

export const installApplet = (
  reader: string,
  gpKeyId: string | null, // null = use default key
  params: InstallParams,
): Promise<CommandResult> =>
  invoke("install_applet", { reader, gpKeyId, params });

export const uninstallApplet = (
  reader: string,
  gpKeyId: string | null,
  packageAid: string,
): Promise<CommandResult> =>
  invoke("uninstall_applet", { reader, gpKeyId, packageAid });

// ---------- Profiles ----------

export const listProfiles = (): Promise<Profile[]> =>
  invoke("list_profiles");

export const saveProfile = (profile: Profile): Promise<void> =>
  invoke("save_profile", { profile });

export const deleteProfile = (id: string): Promise<void> =>
  invoke("delete_profile", { id });

// ---------- Issuance flow ----------

export const runIssuance = (
  reader: string,
  profileId: string,
  subjectVars: Record<string, string>,
): Promise<IssuanceReport> =>
  invoke("run_issuance", { reader, profileId, subjectVars });

// ---------- Event subscriptions ----------

export const onIssuanceProgress = (
  callback: (report: IssuanceReport) => void,
): Promise<UnlistenFn> =>
  listen<IssuanceReport>("issuance:progress", (e) => callback(e.payload));

export const onCommandOutput = (
  callback: (chunk: { stream: "stdout" | "stderr"; data: string }) => void,
): Promise<UnlistenFn> =>
  listen("command:output", (e) => callback(e.payload as any));
