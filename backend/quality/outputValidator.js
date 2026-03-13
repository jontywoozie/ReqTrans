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
        ? ["技术目标", "实现方案", "数据与依赖", "性能与风险", "MVP建议", "缺失信息"]
        : ["Technical Goal", "Implementation Options", "Data & Dependencies", "Performance & Risks", "MVP Plan", "Missing Info"];
    const hasAll = required.every((key) => out.includes(key));
    if (!hasAll) issues.push("缺少产品转开发模式要求的必要章节。");
  }

  if (direction === "dev_to_product") {
    const required =
      lang === "zh"
        ? ["变更解读", "用户影响", "业务影响", "成本与效率", "上线建议", "缺失信息"]
        : ["Change Interpretation", "User Impact", "Business Impact", "Cost & Efficiency", "Rollout Advice", "Missing Info"];
    const hasAll = required.every((key) => out.includes(key));
    if (!hasAll) issues.push("缺少开发转产品模式要求的必要章节。");
  }

  const outHasHardNumber = /\d+(\.\d+)?\s*(%|倍|ms|秒|元|万元|million|billion|\$)/i.test(out);
  const srcHasNumber = /\d/.test(src);
  const hasVerificationTag = out.includes("需验证") || /to be verified/i.test(out);
  if (outHasHardNumber && !srcHasNumber && !hasVerificationTag) {
    issues.push("输出中出现了缺乏依据的硬数字，且没有标注“需验证”。");
  }

  return {
    pass: issues.length === 0,
    issues
  };
}

module.exports = {
  validateOutputQuality
};
