// Single chokepoint for Tauri command invocations.

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
  Pkcs15InitRequest,
  Pkcs15InitResult,
  Fido2Device,
  Fido2Info,
  ResidentCredential,
  DeleteCredentialRequest,
  SetPinRequest,
} from "../types";

// ---------- Readers / Card ----------

export const listReaders = (): Promise<Reader[]> => invoke("list_readers");
export const inspectCard = (reader: string): Promise<CardInfo> =>
  invoke("inspect_card", { reader });

// ---------- GP key vault ----------

export const listGpKeys = (): Promise<GpKeyHandle[]> => invoke("list_gp_keys");
export const generateGpKey = (cardSerial?: string, note?: string): Promise<GpKeyHandle> =>
  invoke("generate_gp_key", { cardSerial, note });
export const deleteGpKey = (id: string): Promise<void> =>
  invoke("delete_gp_key", { id });
export const lockGpKey = (reader: string, keyId: string): Promise<void> =>
  invoke("lock_gp_key", { reader, keyId });

// ---------- Applet management ----------

export const installApplet = (
  reader: string,
  gpKeyId: string | null,
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

export const listProfiles = (): Promise<Profile[]> => invoke("list_profiles");
export const saveProfile = (profile: Profile): Promise<void> =>
  invoke("save_profile", { profile });
export const deleteProfile = (id: string): Promise<void> =>
  invoke("delete_profile", { id });

// ---------- PKCS#15 init ----------

export const pkcs15Create = (req: Pkcs15InitRequest): Promise<Pkcs15InitResult> =>
  invoke("pkcs15_create", { req });

// ---------- FIDO2 ----------

export const fido2ListDevices = (): Promise<Fido2Device[]> =>
  invoke("fido2_list_devices");

export const fido2Info = (path: string): Promise<Fido2Info> =>
  invoke("fido2_info", { path });

export const fido2ListCredentials = (devicePath: string, pin: string): Promise<ResidentCredential[]> =>
  invoke("fido2_list_credentials", { devicePath, pin });

export const fido2DeleteCredential = (req: DeleteCredentialRequest): Promise<void> =>
  invoke("fido2_delete_credential", { req });

export const fido2SetPin = (req: SetPinRequest): Promise<void> =>
  invoke("fido2_set_pin", { req });

export const fido2Reset = (devicePath: string): Promise<void> =>
  invoke("fido2_reset", { devicePath });

// ---------- Issuance ----------

export const runIssuance = (
  reader: string,
  profileId: string,
  subjectVars: Record<string, string>,
): Promise<IssuanceReport> =>
  invoke("run_issuance", { reader, profileId, subjectVars });

// ---------- Events ----------

export interface CommandLogEntry {
  id: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  program: string;
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  error: string | null;
}

export const onCommandLog = (
  callback: (entry: CommandLogEntry) => void,
): Promise<UnlistenFn> =>
  listen<CommandLogEntry>("command:log", (e) => callback(e.payload));

export const onIssuanceProgress = (
  callback: (report: IssuanceReport) => void,
): Promise<UnlistenFn> =>
  listen<IssuanceReport>("issuance:progress", (e) => callback(e.payload));
