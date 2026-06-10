import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";

// GET /api/documents — 获取所有文档摘要列表（兼容旧接口）
export async function GET() {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from("help_documents")
      .select("id, title, category, last_updated, language, source_url, linked_doc_id")
      .order("created_at", { ascending: true });

    if (error) throw new Error(`查询文档列表失败: ${error.message}`);

    // 兼容旧接口字段名
    const docs = (data || []).map((doc: Record<string, unknown>) => ({
      id: doc.id,
      title: doc.title,
      category: doc.category,
      lastUpdated: doc.last_updated,
      language: doc.language,
      sourceUrl: doc.source_url,
      linkedDocId: doc.linked_doc_id,
    }));
    return NextResponse.json({ documents: docs });
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/documents — 获取单个文档详情（兼容旧接口）
export async function POST(request: NextRequest) {
  try {
    const { id } = await request.json();
    if (!id) {
      return NextResponse.json({ error: "缺少文档 ID" }, { status: 400 });
    }

    const client = getSupabaseClient();
    const { data, error } = await client
      .from("help_documents")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error(`查询文档失败: ${error.message}`);
    if (!data) {
      return NextResponse.json({ error: "文档未找到" }, { status: 404 });
    }

    // 兼容旧接口字段名
    const doc = {
      id: data.id,
      title: data.title,
      category: data.category,
      lastUpdated: data.last_updated,
      content: data.content,
      sourceUrl: data.source_url,
      htmlContent: data.html_content,
      language: data.language,
      linkedDocId: data.linked_doc_id,
    };
    return NextResponse.json({ document: doc });
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
