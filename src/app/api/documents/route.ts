import { NextRequest, NextResponse } from "next/server";
import { helpDocuments } from "@/lib/documents";

export async function GET() {
  const docs = helpDocuments.map((doc) => ({
    id: doc.id,
    title: doc.title,
    category: doc.category,
    lastUpdated: doc.lastUpdated,
  }));
  return NextResponse.json({ documents: docs });
}

export async function POST(request: NextRequest) {
  const { id } = await request.json();
  const doc = helpDocuments.find((d) => d.id === id);
  if (!doc) {
    return NextResponse.json({ error: "文档未找到" }, { status: 404 });
  }
  return NextResponse.json({ document: doc });
}
