import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";

// GET /api/docs/[id] — 获取单个文档完整内容
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const { data, error } = await client
      .from("help_documents")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error(`查询文档失败: ${error.message}`);
    if (!data) {
      return NextResponse.json({ error: "文档不存在" }, { status: 404 });
    }

    return NextResponse.json({ document: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/docs/[id] — 删除单个文档
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const { error } = await client.from("help_documents").delete().eq("id", id);
    if (error) throw new Error(`删除文档失败: ${error.message}`);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
