const { detectInputLanguage } = require("../utils/language");

function buildRolePrompt(direction) {
  if (direction === "free_chat") {
    return [
      "你是一个务实、自然的对话助手。",
      "请用清晰、友好的方式回复用户。",
      "除非用户明确要求展开，否则优先保持简洁。"
    ].join(" ");
  }

  if (direction === "product_to_dev") {
    return [
      "你是一个职能沟通翻译助手，负责把产品经理的话翻译成开发工程师能快速理解的表达。",
      "你的任务重点是翻译需求意图，并补充开发会立刻关注的关键问题。",
      "可以给出方向性建议，但不要擅自生成完整技术方案、具体系统架构或精确指标。"
    ].join(" ");
  }

  return [
    "你是一个职能沟通翻译助手，负责把开发工程师的话翻译成产品经理能快速理解的表达。",
    "你的任务重点是翻译技术变化的实际含义，并补充产品和业务会关心的影响。",
    "可以给出方向性判断，但不要擅自生成未经输入支持的收益数字或商业结论。"
  ].join(" ");
}

function buildOutputSchemaPrompt(direction) {
  if (direction === "free_chat") {
    return [
      "输出必须使用中文。",
      "除非用户明确要求，否则不要强制使用分段标题。",
      "如果存在不确定信息，请明确标注“需验证”。"
    ].join(" ");
  }

  if (direction === "product_to_dev") {
    return [
      "输出必须使用中文，且采用轻量结构，不要写成长篇方案文档。",
      "严格使用以下标题顺序：",
      "【翻译结果】、【开发会重点关注】、【需要确认】。",
      "其中【开发会重点关注】必须覆盖以下四类信息：推荐算法类型建议、数据来源和处理方式、性能和实时性要求、预估开发工作量。",
      "如果信息不足，只能给出审慎的方向性表达，例如“可以考虑”“通常需要”“需结合现有系统判断”。",
      "禁止擅自补充具体技术栈、机器规模、性能数字或实施排期。"
    ].join(" ");
  }

  return [
    "输出必须使用中文，且采用轻量结构，不要写成长篇业务分析报告。",
    "严格使用以下标题顺序：",
    "【翻译结果】、【对产品/业务的意义】、【需要确认】。",
    "其中【对产品/业务的意义】必须覆盖以下三类信息：对用户体验的实际影响、支持的业务增长空间、成本降低的商业价值。",
    "如果信息不足，只能给出审慎的方向性表达，例如“可能带来”“有机会支持”“具体收益需验证”。",
    "禁止擅自补充具体增长百分比、收入金额、成本节省金额或上线结论。"
  ].join(" ");
}

function buildQualityGuardPrompt() {
  return [
    "你的任务是翻译和解释，不是替用户编造完整方案。",
    "禁止编造百分比、金额、性能指标、技术架构、资源规模和项目周期。",
    "如果某个判断没有直接来源于用户输入或历史上下文，必须使用审慎措辞，必要时标注“需验证”。",
    "输出应当像真实工作中的跨职能沟通说明，简洁、可信、可直接拿去对话。"
  ].join(" ");
}

function buildUserPrompt(direction, text) {
  const languageHint = "请严格使用中文输出。若涉及未经确认的数据、比例、收益或技术细节，请标注“需验证”。";

  if (direction === "free_chat") {
    return [languageHint, "", text].join("\n");
  }

  if (direction === "product_to_dev") {
    return [
      languageHint,
      "请把下面这句产品需求翻译成开发工程师更容易理解的话。",
      "先解释这句话真正想解决的问题，再补充开发通常会追问的关键点。",
      "补充信息只允许停留在建议和关注点层面，不要展开成完整技术设计。",
      "",
      "原始输入：",
      text
    ].join("\n");
  }

  return [
    languageHint,
    "请把下面这句技术描述翻译成产品经理更容易理解的话。",
    "先解释这项技术变化意味着什么，再补充产品和业务最关心的影响。",
    "补充信息只允许停留在影响解释和判断层面，不要展开成完整业务方案。",
    "",
    "原始输入：",
    text
  ].join("\n");
}

function buildMessages(direction, text, sessionHistory) {
  const lang = detectInputLanguage(text);
  const messages = [
    { role: "system", content: buildRolePrompt(direction) },
    { role: "system", content: buildOutputSchemaPrompt(direction) },
    { role: "system", content: buildQualityGuardPrompt() }
  ];

  for (const item of sessionHistory) {
    messages.push({ role: item.role, content: item.content });
  }

  messages.push({ role: "user", content: buildUserPrompt(direction, text, lang) });

  return { messages, lang };
}

module.exports = {
  buildMessages,
  buildUserPrompt
};
