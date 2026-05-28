// Shared types between Rust backend (serialized JSON) and React frontend.

export interface Reader {
  name: string;
  hasCard: boolean;
  atr?: string;
}

export interface CardInfo {
  reader: string;
  atr: string;
  cplc?: {
    icFabricator: string;
    icType: string;
    osId: string;
    icSerialNumber: string;
    icBatchIdentifier: string;
  };
  applets: Applet[];
  gpVersion?: string;
}

export interface Applet {
  aid: string;
  state: string;
  parent?: string;
  privileges?: string[];
  kind: "ISD" | "APP" | "PKG";
}

export interface GpKeyHandle {
  id: string;
  cardSerial?: string;
  algorithm: "SCP02" | "SCP03";
  keyLengthBytes: number;
  createdAt: string;
  note?: string;
}

export interface Profile {
  id: string;
  name: string;
  description?: string;
  pkcs15: {
    label: string;
    manufacturer: string;
    serialScheme: "cplc" | "uuid" | "incremental" | "template";
    serialTemplate?: string;
  };
  pin: {
    lengthMin: number;
    lengthMax: number;
    generation: "random" | "fixed" | "user-chosen";
    fixedValue?: string;
  };
  puk: {
    length: number;
    generation: "random" | "fixed";
    fixedValue?: string;
  };
  keys: KeyPlanEntry[];
  ca?: {
    url: string;
    rootCertPath: string;
    clientCertPath?: string;
    clientKeyPath?: string;
  };
}

export interface KeyPlanEntry {
  slotId: number;
  label: string;
  type: "rsa" | "ec";
  size: number;
  curve?: string;
  certValidityDays: number;
  certSubjectTemplate: string;
}

export interface InstallParams {
  capPath: string;
  packageAid: string;
  appletAid: string;
  instanceAid?: string;
  privileges?: string;
}

export interface IssuanceReport {
  startedAt: string;
  finishedAt?: string;
  profileId: string;
  cardSerial: string;
  steps: IssuanceStep[];
  status: "running" | "ok" | "failed";
}

export interface IssuanceStep {
  name: string;
  startedAt: string;
  finishedAt?: string;
  status: "running" | "ok" | "failed" | "skipped";
  detail?: string;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// ---------- PKCS#15 init ----------

export interface Pkcs15InitRequest {
  reader: string;
  label: string;
  manufacturer: string;
  serial: string;
  pin: string;
  puk: string;
  profileDirOverride?: string;
}

export interface Pkcs15InitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  credentialsVaultId: string;
}

// ---------- FIDO2 ----------

export interface Fido2Device {
  path: string;
  product: string;
  vendor: string;
}

export interface Fido2Info {
  path: string;
  aaguid?: string;
  versions: string[];
  extensions: string[];
  options: [string, boolean][];
  pinRetries?: number;
  uvRetries?: number;
}

export interface ResidentCredential {
  rpId: string;
  userName?: string;
  userDisplayName?: string;
  credentialId: string;
}

export interface DeleteCredentialRequest {
  devicePath: string;
  credentialId: string;
  pin: string;
}

export interface SetPinRequest {
  devicePath: string;
  oldPin?: string;
  newPin: string;
}
