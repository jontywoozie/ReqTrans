# ReqTrans：职能沟通翻译助手

一个用于「产品经理 <-> 开发工程师」跨职能沟通翻译的 AI 工具。

它的目标不是替用户生成一整份方案文档，而是把一句话翻译成对方更容易理解的表达，同时补充对方最关心的关键关注点与待确认信息。

## 示例视频

### 产品 -> 开发

[示例视频：产品给开发](./example_vedios/%E4%BA%A7%E5%93%81%E7%BB%99%E5%BC%80%E5%8F%91.mp4)

### 开发 -> 产品

[示例视频：开发给产品](./example_vedios/%E5%BC%80%E5%8F%91%E7%BB%99%E4%BA%A7%E5%93%81.mp4)

## 项目特点

- 双向翻译：支持 `产品 -> 开发` 和 `开发 -> 产品`
- 流式回复：前端按对话形式实时展示生成内容
- 会话管理：支持新建、切换、删除、回放历史会话
- 本地持久化：会话列表和消息内容保存到 `storage/sessions.json`
- 提示词工程：围绕“翻译”而不是“写方案”来设计输出

## 功能说明

### 1. 产品 -> 开发

把产品需求翻译成开发工程师更容易理解的话，并补充开发需要重点关注的内容：

- 推荐算法类型建议
- 数据来源和处理方式
- 性能和实时性要求
- 预估开发工作量

### 2. 开发 -> 产品

把技术变更翻译成产品经理更容易理解的话，并补充产品和业务最关心的内容：

- 对用户体验的实际影响
- 支持的业务增长空间
- 成本降低的商业价值

### 3. 闲聊模式

除了双向翻译，还支持 `我只想聊聊` 模式，作为普通中文对话助手使用。

## 快速开始

### 1. 环境准备

请先确认本地环境满足以下条件：

1. 已安装 Node.js，建议版本 `18+`，推荐 `20+`
2. 已安装 npm
3. 当前终端位于项目根目录

可以先执行：

```bash
node -v
npm -v
```

如果这两个命令不能正常输出版本号，先修复 Node.js 环境。

### 2. 进入项目目录

如果你已经打开了本项目目录，可以跳过这一步。

```bash
cd e:\a_Program\ReqTrans
```

### 3. 配置环境变量

先复制环境变量模板：

```bash
# Windows PowerShell
Copy-Item .env.example .env

# macOS / Linux
cp .env.example .env
```

然后打开 `.env`，至少配置以下内容：

```env
BACKEND_PORT=43127
FRONTEND_PORT=43128

LLM_PROVIDER=openai_compatible
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4.1-mini
LLM_API_KEY=your_api_key_here
```

字段说明：

- `BACKEND_PORT`：后端服务端口
- `FRONTEND_PORT`：前端服务端口
- `LLM_PROVIDER`：当前默认使用 `openai_compatible`
- `LLM_BASE_URL`：模型厂商兼容接口地址
- `LLM_MODEL`：你要调用的具体模型名
- `LLM_API_KEY`：模型厂商提供的 API Key

可选配置：

```env
# 留空则使用模型默认 max tokens
LLM_MAX_TOKENS=

# 上游繁忙时的自动重试次数
LLM_RETRY_MAX=3

# 重试基础等待时间（毫秒）
LLM_RETRY_BASE_MS=800

# 多轮会话带入的上下文消息条数
SESSION_CONTEXT_MESSAGES=12
```

如果你使用 Kimi（Moonshot），可以这样配置：

```env
LLM_PROVIDER=openai_compatible
LLM_BASE_URL=https://api.moonshot.cn/v1
LLM_MODEL=kimi-k2-turbo-preview
LLM_API_KEY=你的MoonshotKey
```

### 4. 启动服务

这个项目前后端是分开启动的，需要两个终端窗口。

终端 A：启动后端

```bash
npm run dev:backend
```

终端 B：启动前端

```bash
npm run dev:frontend
```

### 5. 验证服务是否正常

先检查后端健康接口：

```text
http://localhost:43127/health
```

正常情况下会返回：

```json
{"ok":true,"service":"reqtrans-agent"}
```

再打开前端页面：

```text
http://localhost:43128
```

### 6. 开始使用

首次使用建议按这个顺序操作：

1. 点击左侧 `新建会话`
2. 选择身份：
   - `我是产品`
   - `我是开发`
   - `我只想聊聊`
3. 输入内容后直接按回车发送
4. 如果要换行，使用 `Shift + Enter`
5. 查看流式回复结果
6. 切换左侧会话列表，可回看历史内容

### 7. 常见问题

- 端口被占用：修改 `.env` 中的 `BACKEND_PORT` 或 `FRONTEND_PORT`
- 模型 429/繁忙：稍后重试，或增加 `LLM_RETRY_MAX`
- 鉴权失败：检查 `LLM_API_KEY` 是否正确
- 调不到模型：检查 `LLM_BASE_URL` 和 `LLM_MODEL`
- 会话没保存：确认项目根目录下有 `storage/sessions.json`

## 测试用例

### 用例 1：产品 -> 开发

输入：

```text
我们需要一个智能推荐功能，提升用户停留时长
```

预期输出应体现：

- 先把需求翻译成开发更容易理解的话
- 给出推荐算法类型建议，例如协同过滤、内容推荐等
- 说明可能涉及的数据来源和处理方式
- 说明开发会关注的性能和实时性要求
- 给出工作量判断，且使用审慎措辞

### 用例 2：开发 -> 产品

输入：

```text
我们优化了数据库查询，QPS提升了30%
```

预期输出应体现：

- 先把技术变化翻译成产品能理解的话
- 说明对用户体验的实际影响
- 说明支持的业务增长空间
- 说明成本降低的商业价值
- 对无法直接确认的收益明确标注“需验证”

## 提示词设计说明

### 1. 设计目标

这道题的重点是“翻译”，不是“自动生成完整方案”。

所以本项目的提示词设计遵循三条原则：

1. 先翻译原话，再补充对方关心的信息
2. 补充要有帮助，但不能编造成熟方案
3. 信息不足时优先提出“需要确认”，而不是假装知道

### 2. 两个方向的差异

`产品 -> 开发`

- 核心目标：把业务诉求翻译成工程关注点
- 输出重点：算法建议、数据来源、性能要求、工作量判断

`开发 -> 产品`

- 核心目标：把技术变化翻译成业务含义
- 输出重点：用户体验影响、业务增长空间、成本价值

### 3. 提示词结构

当前提示词系统分三层：

- 角色层：定义当前在替谁翻译、翻译给谁看
- 输出结构层：约束输出格式和必须覆盖的重点
- 质量门禁层：限制模型不要编造数字、技术栈和收益结论

### 4. 如何补充缺失信息

项目不会强行把一句话扩写成完整设计方案，而是：

- 提醒对方会关心什么
- 给出方向性建议
- 把关键缺失项放到 `【需要确认】`

### 5. 如何保证结果有实用价值

- 输出结构短，适合真实工作沟通
- 内容紧贴题目要求的关键维度
- 对不确定信息使用“需验证”
- 后端带输出质检，避免明显跑偏

## API 简述

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

- `event: session`：当前会话信息
- `event: chunk`：文本分片
- `event: done`：生成完成
- `event: error`：生成失败

### `POST /session/new`

创建新会话，返回 `session_id`。

### `GET /session/list`

返回会话摘要列表。

### `GET /session/history?session_id=...`

返回指定会话的历史消息，用于前端回放。

### `POST /session/clear`

删除指定会话。

## 项目结构

```text
.
├─ backend/
│  ├─ prompts/
│  │  └─ index.js
│  ├─ quality/
│  │  └─ outputValidator.js
│  ├─ utils/
│  │  └─ language.js
│  └─ server.js
├─ example_vedios/
│  ├─ 产品给开发.mp4
│  └─ 开发给产品.mp4
├─ frontend/
│  ├─ index.html
│  └─ server.js
├─ storage/
│  └─ sessions.json
├─ .env.example
├─ package.json
└─ README.md
```
