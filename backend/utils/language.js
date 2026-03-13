function detectInputLanguage(text) {
  const content = String(text || "");
  const cjkCount = (content.match(/[\u4e00-\u9fff]/g) || []).length;
  const latinCount = (content.match(/[A-Za-z]/g) || []).length;
  return cjkCount >= latinCount ? "zh" : "en";
}

module.exports = {
  detectInputLanguage
};
