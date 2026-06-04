import { NextRequest, NextResponse } from "next/server";
import { importHelpDocument, parseHttpUrl } from "@/lib/import-help-document";

export async function POST(request: NextRequest) {
  const { url } = await request.json();

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "请输入帮助文档链接" }, { status: 400 });
  }

  try {
    const parsedUrl = parseHttpUrl(url);
    const document = await importHelpDocument(parsedUrl);
    return NextResponse.json({ document });
  } catch (error) {
    const message = error instanceof Error ? error.message : "链接导入失败，请确认网页可访问后重试";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}