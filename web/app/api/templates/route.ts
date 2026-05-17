import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type TemplateInfo = {
  name: string;
  description: string;
  displayName: string;
};

export async function GET() {
  const projectRoot = path.resolve(process.cwd(), "..");
  const templatesDir = path.join(projectRoot, "templates");
  const templates: TemplateInfo[] = [];

  try {
    const entries = await fs.readdir(templatesDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }

      const templatePath = path.join(templatesDir, entry.name);
      try {
        const raw = await fs.readFile(templatePath, "utf-8");
        const parsed = JSON.parse(raw) as {
          name?: unknown;
          description?: unknown;
        };

        const name =
          typeof parsed.name === "string"
            ? parsed.name
            : entry.name.replace(/\.json$/i, "");
        const description =
          typeof parsed.description === "string" ? parsed.description : "";

        templates.push({
          name,
          description,
          displayName: description ? `${description}（${name}）` : name,
        });
      } catch (error) {
        console.warn(`跳过损坏的模板文件：${templatePath}`, error);
      }
    }

    templates.sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ success: true, templates });
  } catch (error) {
    console.error("读取模板目录失败", error);
    return NextResponse.json(
      { success: false, message: "模板目录读取失败。" },
      { status: 500 },
    );
  }
}
