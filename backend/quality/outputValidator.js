function validateOutputQuality({ direction, inputText, outputText, lang }) {
  const issues = [];
  const out = String(outputText || "").trim();
  const src = String(inputText || "");

  if (!out) issues.push("输出为空。");

  if (lang === "zh") {
    const cjkRatio = (out.match(/[\u4e00-\u9fff]/g) || []).length / Math.max(out.length, 1);
    if (cjkRatio < 0.15) issues.push("语言不匹配：当前任务要求输出中文。");
  } else {
    const latinRatio = (out.match(/[A-Za-z]/g) || []).length / Math.max(out.length, 1);
    if (latinRatio < 0.15) issues.push("语言不匹配：当前任务要求输出英文。");
  }

  if (direction === "product_to_dev") {
    const required =
      lang === "zh"
        ? ["翻译结果", "开发会重点关注", "需要确认"]
        : ["Translation", "Developer Focus", "Need Confirmation"];
    const hasAll = required.every((key) => out.includes(key));
    if (!hasAll) issues.push("缺少产品转开发模式要求的必要章节。");

    const focusChecks =
      lang === "zh"
        ? ["算法", "数据", "性能", "工作量"]
        : ["algorithm", "data", "performance", "effort"];
    const hasFocus = focusChecks.every((key) => out.toLowerCase().includes(String(key).toLowerCase()));
    if (!hasFocus) issues.push("产品转开发的输出没有覆盖算法、数据、性能、工作量这四类关键信息。");
  }

  if (direction === "dev_to_product") {
    const required =
      lang === "zh"
        ? ["翻译结果", "对产品/业务的意义", "需要确认"]
        : ["Translation", "Product/Business Meaning", "Need Confirmation"];
    const hasAll = required.every((key) => out.includes(key));
    if (!hasAll) issues.push("缺少开发转产品模式要求的必要章节。");

    const focusChecks =
      lang === "zh"
        ? ["用户体验", "业务增长", "成本"]
        : ["user experience", "business growth", "cost"];
    const hasFocus = focusChecks.every((key) => out.toLowerCase().includes(String(key).toLowerCase()));
    if (!hasFocus) issues.push("开发转产品的输出没有覆盖用户体验、业务增长、成本价值这三类关键信息。");
  }

  const outHasHardNumber = /\d+(\.\d+)?\s*(%|倍|ms|秒|元|万元|million|billion|\$)/i.test(out);
  const srcHasNumber = /\d/.test(src);
  const hasVerificationTag = out.includes("需验证") || /to be verified/i.test(out);
  if (outHasHardNumber && !srcHasNumber && !hasVerificationTag) {
    issues.push("输出中出现了缺乏依据的硬数字，且没有标注“需验证”。");
  }

  const hallucinatedTechPattern = /(Redis|Flink|Kafka|HBase|Hive|Feature Store|GRPC|gRPC|TensorFlow|XGBoost|Wide&Deep)/i;
  if (direction === "product_to_dev" && hallucinatedTechPattern.test(out) && !hallucinatedTechPattern.test(src)) {
    issues.push("输出引入了原始输入中没有出现的具体技术栈，超出了“翻译”范围。");
  }

  return {
    pass: issues.length === 0,
    issues
  };
}

module.exports = {
  validateOutputQuality
};
