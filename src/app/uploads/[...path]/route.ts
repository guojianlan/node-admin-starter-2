import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

function uploadRoot() {
  return path.join(process.cwd(), "storage", "uploads");
}

export async function GET(_: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const resolvedParams = await params;
  const relativePath = resolvedParams.path.join("/");
  const root = uploadRoot();
  const filePath = path.resolve(root, relativePath);

  if (!filePath.startsWith(root)) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const buffer = await fs.readFile(filePath);
    return new Response(buffer);
  } catch {
    return new Response("Not Found", { status: 404 });
  }
}
