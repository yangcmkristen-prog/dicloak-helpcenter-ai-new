# 帮助中心文档维护助手

## 项目概览

AI 驱动的帮助中心文档维护工具。用户输入新功能描述后，AI 自动检索帮助中心内需要更新的文档，并以抽屉式界面标注出需删除和需新增的内容。

## 技术栈

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **Styling**: Tailwind CSS 4
- **AI**: coze-coding-dev-sdk (LLM 流式输出)
- **Model**: doubao-seed-2-0-pro-260215
- **Database**: Supabase (PostgreSQL) — 文档跨设备同步

## 目录结构

```
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── analyze/route.ts     # AI 分析接口 (SSE 流式)
│   │   │   ├── docs/route.ts        # 文档 CRUD 接口 (Supabase)
│   │   │   ├── docs/[id]/route.ts   # 单文档操作接口
│   │   │   ├── documents/route.ts   # 文档查询接口 (兼容旧接口)
│   │   │   ├── import-url/route.ts  # URL 导入接口
│   │   │   └── import-site/route.ts # 批量站点导入接口
│   │   ├── layout.tsx               # 根布局
│   │   ├── page.tsx                 # 主页面 (客户端组件)
│   │   └── globals.css              # 全局样式
│   ├── components/ui/              # shadcn/ui 组件库
│   ├── lib/
│   │   ├── documents.ts             # 帮助中心文档数据 (AI 分析兜底)
│   │   ├── import-help-document.ts  # 文档导入工具
│   │   └── utils.ts                 # 工具函数
│   └── storage/database/
│       ├── supabase-client.ts       # Supabase 客户端初始化
│       └── shared/schema.ts         # Drizzle 表结构定义
├── DESIGN.md                        # 设计规范
└── AGENTS.md                        # 本文件
```

## 构建与测试命令

- 开发: `pnpm dev`
- 构建: `pnpm build`
- 类型检查: `pnpm ts-check`
- Lint: `pnpm lint`
- 生产启动: `pnpm start`

## 核心功能

1. **文档数据管理**: `src/lib/documents.ts` 中定义了8篇帮助中心文档（AI 分析兜底数据）
2. **文档跨设备同步**: 通过 Supabase `help_documents` 表存储所有上传/导入的文档，支持跨设备访问
3. **AI 分析接口**: `/api/analyze` 接收新功能描述，通过 SSE 流式返回受影响的文档及修改建议
4. **文档 CRUD 接口**: `/api/docs` 提供文档的增删改查（Supabase），支持单条和批量操作
5. **文档查询接口**: `/api/documents` 提供文档列表和详情查询（兼容旧接口）
6. **抽屉式 UI**: 点击受影响文档卡片，右侧抽屉展示完整文档内容，用红色标注删除、绿色标注新增

## API 接口

### GET /api/docs
返回所有文档摘要列表（从 Supabase 查询）

### POST /api/docs
创建/更新文档，支持单条和批量（upsert）
请求体（单条）: `{ "id": "doc-001", "title": "...", "content": "..." }`
请求体（批量）: `[{ "id": "doc-001", ... }, { "id": "doc-002", ... }]`

### DELETE /api/docs
删除文档，支持单条和批量
请求体: `{ "id": "doc-001" }` 或 `{ "ids": ["doc-001", "doc-002"] }`

### GET /api/docs/[id]
获取单个文档完整内容

### DELETE /api/docs/[id]
删除单个文档

### GET /api/documents
返回所有文档摘要列表（兼容旧接口）

### POST /api/documents
请求体: `{ "id": "doc-001" }`
返回指定文档的完整内容

### POST /api/analyze
请求体: `{ "feature": "新功能描述" }`
返回 SSE 流，最终 JSON 结构:
```json
{
  "affectedDocs": [{
    "docId": "doc-001",
    "docName": "文档标题",
    "reason": "修改原因",
    "changes": [{
      "type": "delete|add",
      "originalText": "需删除的原文",
      "newContent": "需新增的内容",
      "position": "after|before|replace",
      "referenceText": "定位参考文本",
      "reason": "变更原因"
    }]
  }]
}
```

## 编码规范

- 严格 TypeScript，禁止隐式 any
- 仅使用 pnpm 管理依赖
- 后端 LLM 调用必须使用 coze-coding-dev-sdk，不得使用 Mock
- 流式输出优先：AI 分析必须走 SSE 流式
