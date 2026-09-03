import nodemailer from "nodemailer";
import { sqlite } from "@/server/db";
import { decryptSecret } from "./secret";

export type MailAccountRow = {
  id: number;
  name: string;
  code: string;
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  passwordEncrypted: string | null;
  fromName: string | null;
  fromEmail: string;
  replyTo: string | null;
  isDefault: boolean;
  status: number;
};

export async function getMailAccount(id?: number) {
  const where = id
    ? "id = ? AND deleted_at IS NULL"
    : "is_default = true AND deleted_at IS NULL AND status = 1";
  const row = (await sqlite
    .prepare(
      `SELECT
        id,
        name,
        code,
        host,
        port,
        secure,
        username,
        password_encrypted AS passwordEncrypted,
        from_name AS fromName,
        from_email AS fromEmail,
        reply_to AS replyTo,
        is_default AS isDefault,
        status
       FROM sys_mail_account
       WHERE ${where}
       ORDER BY id ASC
       LIMIT 1`,
    )
    .get(...(id ? [id] : []))) as MailAccountRow | undefined;
  if (!row) throw new Error(id ? "邮件账号不存在" : "未配置可用的默认邮件账号");
  return row;
}

function createTransport(account: MailAccountRow) {
  return nodemailer.createTransport({
    host: account.host,
    port: account.port,
    secure: account.secure,
    auth: account.username
      ? {
          user: account.username,
          pass: decryptSecret(account.passwordEncrypted) ?? "",
        }
      : undefined,
  });
}

function normalizeMailError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/auth|login|credential|password/i.test(message)) return "SMTP 认证失败";
  if (/recipient|rcpt|address/i.test(message)) return "收件地址错误";
  if (/connect|timeout|dns|getaddrinfo|econnrefused|network/i.test(message)) {
    return "SMTP 连接失败";
  }
  return message || "邮件发送失败";
}

export async function sendTestMail(input: {
  accountId?: number;
  to: string;
  subject?: string;
  text?: string;
}) {
  const account = await getMailAccount(input.accountId);
  if (account.status !== 1) throw new Error("邮件账号已停用");

  const transporter = createTransport(account);
  try {
    await transporter.verify();
    await transporter.sendMail({
      from: account.fromName
        ? `"${account.fromName}" <${account.fromEmail}>`
        : account.fromEmail,
      to: input.to,
      replyTo: account.replyTo || undefined,
      subject: input.subject || "Admin Base SMTP 测试邮件",
      text: input.text || "这是一封 Admin Base SMTP 配置测试邮件。",
    });
  } catch (error) {
    throw new Error(normalizeMailError(error));
  }
}

export async function sendMail(input: {
  accountId?: number;
  to: string;
  subject: string;
  text: string;
}) {
  const account = await getMailAccount(input.accountId);
  if (account.status !== 1) throw new Error("邮件账号已停用");

  const transporter = createTransport(account);
  try {
    const info = await transporter.sendMail({
      from: account.fromName
        ? `"${account.fromName}" <${account.fromEmail}>`
        : account.fromEmail,
      to: input.to,
      replyTo: account.replyTo || undefined,
      subject: input.subject,
      text: input.text,
    });
    return { messageId: info.messageId || null };
  } catch (error) {
    throw new Error(normalizeMailError(error));
  }
}
