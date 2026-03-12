# ReqTrans：职能沟通翻译助手

一个用于「产品经理 <-> 开发工程师」沟通翻译的 AI 工具。  
核心目标是把同一段信息翻译成对方能直接理解并用于决策/执行的语言。

项目基于 Node.js 原生 `http` 实现后端与前端，无额外框架依赖，支持流式输出、会话管理与本地会话持久化。

---

## 1. 快速开始

### 1.1 环境准备

请先确认你的本地环境：

1. 安装 Node.js（建议 18+，推荐 20+）
2. 打开终端进入项目根目录
3. 检查 Node 和 npm 是否可用

```bash
node -v
npm -v
```

如果命令报错，请先安装或修复 Node.js 环境变量。

### 1.2 获取代码并进入目录

如果你已经在项目目录可跳过这步。

```bash
# 示例 --请输入你的项目根目录
cd e:\root\ReqTrans
```

### 1.3 配置环境变量

1. 复制模板：

```bash
# Windows PowerShell
Copy-Item .env.example .env

# macOS / Linux
cp .env.example .env
```

2. 打开 `.env`，至少填写以下字段：

```env
BACKEND_PORT=43127
FRONTEND_PORT=43128

LLM_PROVIDER=openai_compatible
# 填写你的大模型运营商地址
LLM_BASE_URL=https://api.openai.com/v1
# 填写你的大模型名称
LLM_MODEL=gpt-4.1-mini
# 填写你的API Key
LLM_API_KEY=your_api_key_here
```

3. 可选字段（不填则使用默认）：

```env
# 限制最大输出 token；留空则走模型默认
# LLM_MAX_TOKENS=420

# 上游繁忙时自动重试（429/503 等）
# LLM_RETRY_MAX=3
# LLM_RETRY_BASE_MS=800

# 会话上下文条数
# SESSION_CONTEXT_MESSAGES=12
```

> 使用 Kimi（Moonshot）示例：
>
> ```env
> LLM_PROVIDER=openai_compatible
> LLM_BASE_URL=https://api.moonshot.cn/v1
> LLM_MODEL=kimi-k2-turbo-preview
> LLM_API_KEY=你的MoonshotKey
> ```

### 1.4 启动服务

在两个终端分别启动后端和前端：

终端 A（后端）：

```bash
npm run dev:backend
```

终端 B（前端）：

```bash
npm run dev:frontend
```

### 1.5 验证是否启动成功

1. 访问后端健康检查：

```text
http://localhost:43127/health
```

应返回类似：

```json
{"ok":true,"service":"reqtrans-agent"}
```

2. 打开前端页面：

```text
http://localhost:43128
```

### 1.6 首次使用建议流程

1. 点击「新建会话」
2. 选择身份（我是产品 / 我是开发 / 我只想聊聊）
3. 输入文本后按回车发送（`Shift + Enter` 换行）
4. 查看流式输出结果

### 1.7 常见问题排查

- 端口被占用：修改 `.env` 的 `BACKEND_PORT` / `FRONTEND_PORT`
- 429 或模型繁忙：稍后重试，或提高 `LLM_RETRY_MAX`
- 无输出或报鉴权错误：检查 `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`
- 会话未持久化：确认项目根目录存在 `storage/sessions.json`

---

## 2. 功能说明

### 2.1 核心翻译能力

- 产品 -> 开发（`product_to_dev`）
- 开发 -> 产品（`dev_to_product`）
- 可选闲聊模式（`free_chat`）

### 2.2 流式输出

- 后端提供 `POST /translate/stream`（SSE）
- 前端实时渲染，支持停止生成

### 2.3 会话管理

- 新建会话、切换会话、删除会话
- 会话列表与会话历史回放
- 会话标题自动取用户首句摘要

### 2.4 本地持久化

- 会话数据存储在：
  - `storage/sessions.json`
- 启动自动加载、变更自动落盘、退出前强制落盘

### 2.5 提示词工程能力（重点）

- 三层提示词结构：
  - 角色层（Role）
  - 输出结构层（Schema）
  - 质量门禁层（Quality Guard）
- 自动语言跟随（中文输入优先中文输出）
- 自动质量校验 + 不达标二次修复
- 明确约束：禁止编造关键数字，缺失信息标注“需验证”

---

## 3. API 简述

### `POST /translate/stream`

请求体：

```json
{
  "direction": "product_to_dev | dev_to_product | free_chat",
  "text": "用户输入内容",
  "session_id": "可选"
}
```

流式事件：

- `event: session` 当前会话信息
- `event: chunk` 文本分片
- `event: done` 完成
- `event: error` 错误

### `POST /session/new`

新建会话，返回 `session_id`。

### `GET /session/list`

返回会话摘要列表。

### `GET /session/history?session_id=...`

返回指定会话消息历史（用于前端回放）。

### `POST /session/clear`

删除指定会话。

---

## 4. 测试用例

### 用例1：产品视角 -> 开发语言

输入：

```text
我们需要一个智能推荐功能，提升用户停留时长
```

预期输出应包含（示例）：

- 技术目标和实现方案（如召回/排序思路）
- 数据与依赖（行为日志、特征来源、埋点）
- 性能与风险（时延目标、稳定性、冷启动等）
- MVP 建议与缺失信息

### 用例2：开发视角 -> 产品语言

输入：

```text
我们优化了数据库查询，QPS提升了30%，P95 从 620ms 降到 240ms
```

预期输出应包含（示例）：

- 变更解读（技术动作对应业务意义）
- 用户影响（体验、等待时长变化）
- 业务影响（转化/留存潜在影响）
- 成本与效率（资源与运维收益）
- 上线建议与缺失信息

---

## 5. 提示词设计说明

### 5.1 如何体现产品/开发视角差异

通过 `direction` 驱动不同角色提示词：

- `product_to_dev`：强调可执行技术方案、数据依赖、性能约束、实现风险
- `dev_to_product`：强调用户价值、业务影响、上线建议、决策可读性

### 5.2 如何主动补充缺失信息

输出结构中强制包含「缺失信息」段落。  
对于输入未提供但决策必须的信息，模型需要明确提出待确认项，而不是跳过。

### 5.3 如何保证输出有实用价值

- 固定结构输出，便于评审会直接使用
- 强制“语言跟随输入”，降低沟通成本
- 质量门禁禁止编造数字，未知内容明确“需验证”
- 不达标时自动二次修复，提升稳定性

---

## 6. 项目结构

```text
.
├─ backend/
│  └─ server.js
├─ frontend/
│  ├─ index.html
│  └─ server.js
├─ storage/
│  └─ sessions.json
├─ .env.example
├─ package.json
└─ README.md
```

---
