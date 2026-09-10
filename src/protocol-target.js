const PROTOCOL_ACTION = "smartpaste";

class NavigationError extends Error {}

function validateTarget(vault, file, block) {
  if (typeof vault !== "string" || !vault || /[\x00-\x1f\x7f]/.test(vault) ||
      typeof file !== "string" || !file.endsWith(".md") || /[\\:\x00-\x1f\x7f]/.test(file) ||
      file.split("/").some(part => !part || part === "." || part === "..") ||
      typeof block !== "string" || !block || /[^A-Za-z0-9-]/.test(block)) {
    throw new NavigationError("הקישור אינו תקין: נדרשים נתיב פתק יחסי ומזהה בלוק תקין.");
  }
  return { vault, file, block };
}

function parseProtocolTarget(params, currentVault) {
  // Obsidian has already decoded values once. Percent signs here are literal.
  if (!params || typeof params !== "object" || Array.isArray(params) ||
      params.action !== PROTOCOL_ACTION ||
      Object.keys(params).some(key => !["action", "vault", "file", "block"].includes(key)) ||
      !["action", "file", "block"].every(key => Object.hasOwn(params, key))) {
    throw new NavigationError("קישור SmartPaste אינו תקין.");
  }
  // Desktop consumes/removes `vault` when routing to the destination window.
  // Mobile/direct dispatch may retain it: validate explicit values as before.
  const vault = Object.hasOwn(params, "vault") ? params.vault : currentVault;
  const target = validateTarget(vault, params.file, params.block);
  if (target.vault !== currentVault) {
    throw new NavigationError("הקישור מיועד לכספת אחרת. יש לפתוח את הכספת המתאימה.");
  }
  return target;
}

function encode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, char =>
    "%" + char.charCodeAt(0).toString(16).toUpperCase());
}

function buildBlockUri(vault, file, block) {
  validateTarget(vault, file, block);
  return `obsidian://${PROTOCOL_ACTION}?vault=${encode(vault)}&file=${encode(file)}&block=${encode(block)}`;
}

module.exports = { PROTOCOL_ACTION, NavigationError, parseProtocolTarget, buildBlockUri };
