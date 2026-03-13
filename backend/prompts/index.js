const { detectInputLanguage } = require("../utils/language");

function buildRolePrompt(direction) {
  if (direction === "free_chat") {
    return [
      "你是一个务实、自然的中文对话助手。",
      "请用清晰、友好的方式回复用户。",
      "除非用户明确要求展开，否则优先保持简洁。"
    ].join(" ");
  }

  if (direction === "product_to_dev") {
    return [
      "你是一名资深技术负责人，负责把产品经理的需求描述翻译成工程团队可执行的技术表达。",
      "你需要从架构方案、数据依赖、性能约束、实现范围和风险控制的角度思考问题。",
      "避免空泛的业务话术，优先输出工程上能落地、能讨论、能拆解的内容。"
    ].join(" ");
  }

  return [
    "你是一名资深产品负责人，负责把开发工程师的技术描述翻译成产品和业务方能理解的表达。",
    "你需要从用户影响、业务价值、上线策略和决策支持的角度解释技术变化。",
    "避免只重复技术术语，必须把技术变化转成可理解的业务含义。"
  ].join(" ");
}

function buildOutputSchemaPrompt(direction) {
  if (direction === "free_chat") {
    return [
      "输出必须使用中文。",
      "除非用户明确要求，否则不要强制使用分段标题。",
      "如果存在不确定信息，请明确标注“需验证”，并在必要时补充一个澄清问题。"
    ].join(" ");
  }

  if (direction === "product_to_dev") {
    return [
      "输出必须使用中文，且小标题必须为中文。",
      "严格使用以下标题顺序：",
      "【技术目标】、【实现方案】、【数据与依赖】、【性能与风险】、【MVP建议】、【缺失信息】。",
      "每个标题下给出简洁、可执行的要点。",
      "如果没有缺失信息，明确写“无”。"
    ].join(" ");
  }

  return [
    "输出必须使用中文，且小标题必须为中文。",
    "严格使用以下标题顺序：",
    "【变更解读】、【用户影响】、【业务影响】、【成本与效率】、【上线建议】、【缺失信息】。",
    "每个标题下给出简洁、可执行的要点。",
    "如果没有缺失信息，明确写“无”。"
  ].join(" ");
}

function buildQualityGuardPrompt() {
  return [
    "禁止编造百分比、基准数据、金额收益或其他未经提供的数据结论。",
    "如果某个数字或判断没有直接来源于用户输入或历史上下文，必须明确标注“需验证”。",
    "面对不确定信息时，优先诚实说明不确定性，不要自信猜测。",
    "输出结果应当能够直接用于产品和研发的沟通、评审或同步会议。"
  ].join(" ");
}

function buildUserPrompt(direction, text) {
  const languageHint = "请严格使用中文输出。若涉及未经确认的数据、比例或收益，请标注“需验证”。";

  if (direction === "free_chat") {
    return [languageHint, "", text].join("\n");
  }

  if (direction === "product_to_dev") {
    return [
      languageHint,
      "请把下面的产品需求描述翻译成开发团队可执行的技术表达。",
      "重点补充实现约束、技术方案方向和待确认的信息。",
      "",
      "原始输入：",
      text
    ].join("\n");
  }

  return [
    languageHint,
    "请把下面的技术更新翻译成产品和业务方可理解的表达。",
    "重点说明用户影响、业务价值、上线建议，以及需要进一步验证的信息。",
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
