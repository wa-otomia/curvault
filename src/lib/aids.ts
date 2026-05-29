// Catalogue of well-known JavaCard / GlobalPlatform AIDs.
//
// A few entries are flagged `protected` — these are the things that
// should NEVER be uninstalled from a working card (the GP Issuer
// Security Domain, the javacard.framework / javacardx.crypto packages,
// java.lang). Deleting them bricks the card. The UI uses the same
// catalogue to draw friendly names and to grey out Delete actions.
//
// Longest-prefix wins, so a more specific match (e.g. IsoApplet's
// 24-char instance AID) overrides a shorter prefix (the 22-char
// package AID).

export interface AidEntry {
  prefix: string;
  name: string;
  protected?: boolean;
}

export const AID_CATALOGUE: AidEntry[] = [
  // ---- IsoApplet ----
  { prefix: "F276A288BCFBA69D34F31001", name: "IsoApplet (instance)" },
  { prefix: "F276A288BCFBA69D34F310",   name: "IsoApplet (package)" },

  // ---- FIDO ----
  { prefix: "A0000006472F0001",         name: "FIDO U2F applet" },
  { prefix: "A000000647",               name: "FIDO Alliance" },

  // ---- GlobalPlatform card manager (protected) ----
  { prefix: "A0000001515350",           name: "GP SSD package",     protected: true },
  { prefix: "A000000151",               name: "GlobalPlatform ISD", protected: true },

  // ---- Java Card framework / standard library (protected) ----
  { prefix: "A0000000620204",           name: "javacard.framework", protected: true },
  { prefix: "A0000000620202",           name: "javacardx.crypto",   protected: true },
  { prefix: "A0000000620201",           name: "javacard.security",  protected: true },
  { prefix: "A0000000620001",           name: "java.lang",          protected: true },

  // ---- PIV ----
  { prefix: "A000000308",               name: "PIV applet" },

  // ---- Payment schemes (informational; almost never on dev cards) ----
  { prefix: "A0000000041010",           name: "Mastercard credit/debit" },
  { prefix: "A0000000031010",           name: "Visa credit/debit" },
];

function clean(aid: string): string {
  return aid.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
}

function longestMatch(aid: string): AidEntry | undefined {
  const c = clean(aid);
  return [...AID_CATALOGUE]
    .sort((a, b) => b.prefix.length - a.prefix.length)
    .find((e) => c.startsWith(e.prefix));
}

/** Friendly name for an AID, or null when nothing matches. */
export function aidName(aid: string): string | null {
  return longestMatch(aid)?.name ?? null;
}

/**
 * True if the AID belongs to a component that must not be uninstalled
 * from a functioning card (GP ISD/SSD, javacard standard packages).
 */
export function isProtectedAid(aid: string): boolean {
  return longestMatch(aid)?.protected ?? false;
}
