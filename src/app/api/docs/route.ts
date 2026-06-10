import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";

// GET /api/docs — 获取所有文档摘要列表
export async function GET() {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from("help_documents")
      .select("id, title, category, content, html_content, last_updated, language, source_url")
      .order("created_at", { ascending: true });

    if (error) throw new Error(`查询文档列表失败: ${error.message}`);

    return NextResponse.json({ documents: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/docs — 创建文档（支持单条和批量）
export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const body = await request.json();

    // 批量创建
    if (Array.isArray(body)) {
      const rows = body.map((doc: Record<string, unknown>) => ({
        id: doc.id as string,
        title: doc.title as string,
        category: (doc.category as string) || "未分类",
        last_updated: (doc.last_updated as string) || new Date().toISOString().split("T")[0],
        content: doc.content as string,
        source_url: (doc.source_url as string) || null,
        html_content: (doc.html_content as string) || null,
        language: (doc.language as string) || "unknown",
        linked_doc_id: (doc.linked_doc_id as string) || null,
      }));

      const { data, error } = await client
        .from("help_documents")
        .upsert(rows, { onConflict: "id" })
        .select("id, title, category, last_updated, language, source_url, linked_doc_id");

      if (error) throw new Error(`批量创建文档失败: ${error.message}`);
      return NextResponse.json({ documents: data });
    }

    // 单条创建
    const { id, title, category, last_updated, content, source_url, html_content, language, linked_doc_id } = body as {
      id: string;
      title: string;
      category?: string;
      last_updated?: string;
      content: string;
      source_url?: string;
      html_content?: string;
      language?: string;
      linked_doc_id?: string | null;
    };

    if (!id || !title || !content) {
      return NextResponse.json({ error: "缺少必填字段: id, title, content" }, { status: 400 });
    }

    const { data, error } = await client
      .from("help_documents")
      .upsert(
        {
          id,
          title,
          category: category || "未分类",
          last_updated: last_updated || new Date().toISOString().split("T")[0],
          content,
          source_url: source_url || null,
          html_content: html_content || null,
          language: language || "unknown",
          linked_doc_id: linked_doc_id || null,
        },
        { onConflict: "id" }
      )
      .select("id, title, category, last_updated, content, html_content, language, source_url");

    if (error) throw new Error(`创建文档失败: ${error.message}`);
    return NextResponse.json({ document: data[0] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH /api/docs — 更新文档关联关系
export async function PATCH(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const body = await request.json();
    const { links } = body as { links?: { id?: string; linked_doc_id?: string | null }[] };

    if (!Array.isArray(links) || links.length === 0) {
      return NextResponse.json({ error: "缺少 links 参数" }, { status: 400 });
    }

    const normalizedLinks = links
      .filter((link) => typeof link.id === "string" && link.id.trim().length > 0)
      .map((link) => ({
        id: link.id as string,
        linked_doc_id: typeof link.linked_doc_id === "string" && link.linked_doc_id.trim().length > 0 ? link.linked_doc_id : null,
      }));

    if (normalizedLinks.length === 0) {
      return NextResponse.json({ error: "缺少有效文档 ID" }, { status: 400 });
    }

    for (const link of normalizedLinks) {
      const { error } = await client
        .from("help_documents")
        .update({ linked_doc_id: link.linked_doc_id })
        .eq("id", link.id);

      if (error) throw new Error(`更新文档关联失败: ${error.message}`);
    }

    return NextResponse.json({ success: true, updatedCount: normalizedLinks.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/docs — 删除文档（支持单条和批量）
export async function DELETE(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const body = await request.json();
    const { id, ids } = body as { id?: string; ids?: string[] };

    if (ids && ids.length > 0) {
      const { error } = await client.from("help_documents").delete().in("id", ids);
      if (error) throw new Error(`批量删除文档失败: ${error.message}`);
      return NextResponse.json({ success: true, deletedCount: ids.length });
    }

    if (id) {
      const { error } = await client.from("help_documents").delete().eq("id", id);
      if (error) throw new Error(`删除文档失败: ${error.message}`);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "缺少 id 或 ids 参数" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
