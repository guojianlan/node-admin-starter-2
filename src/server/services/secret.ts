import crypto from "node:crypto";
import { getAdminBaseEnv } from "@/server/env";

const ALGORITHM = "aes-256-gcm";

function getKey() {
  return crypto.createHash("sha256").update(getAdminBaseEnv().adminBaseSecretKey).digest();
}

export function encryptSecret(value?: string | null) {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(".");
}

export function decryptSecret(value?: string | null) {
  if (!value) return null;
  const [ivRaw, tagRaw, encryptedRaw] = value.split(".");
  if (!ivRaw || !tagRaw || !encryptedRaw) return null;
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivRaw, "base64"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
