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
  state: "OP_READY" | "INITIALIZED" | "SECURED" | "LOCKED" | "TERMINATED" | "SELECTABLE" | "INSTALLED" | "LOADED";
  parent?: string;
  privileges?: string[];
  kind: "ISD" | "APP" | "PKG";
}

export interface GpKeyHandle {
  /** Stable identifier; format `gp-key:<card-serial>` or `gp-key:<uuid>`. */
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
  size: number;        // e.g. 2048 for RSA, 256 for EC P-256
  curve?: string;      // e.g. "prime256v1"
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
