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

## 目录结构

```
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── analyze/route.ts     # AI 分析接口 (SSE 流式)
│   │   │   └── documents/route.ts   # 文档数据接口
│   │   ├── layout.tsx               # 根布局
│   │   ├── page.tsx                 # 主页面 (客户端组件)
│   │   └── globals.css              # 全局样式
│   ├── components/ui/              # shadcn/ui 组件库
│   └── lib/
│       ├── documents.ts             # 帮助中心文档数据
│       └── utils.ts                 # 工具函数
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

1. **文档数据管理**: `src/lib/documents.ts` 中定义了8篇帮助中心文档
2. **AI 分析接口**: `/api/analyze` 接收新功能描述，通过 SSE 流式返回受影响的文档及修改建议
3. **文档查询接口**: `/api/documents` 提供文档列表和详情查询
4. **抽屉式 UI**: 点击受影响文档卡片，右侧抽屉展示完整文档内容，用红色标注删除、绿色标注新增

## API 接口

### GET /api/documents
返回所有文档摘要列表

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
