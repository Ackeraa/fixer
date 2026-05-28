const mammoth = require("mammoth");

async function extractTextFromBuffer(buffer) {
  const result = await parseDocxBuffer(buffer);
  return result.text;
}

async function parseDocxBuffer(buffer) {
  const [rawTextResult, htmlResult] = await Promise.all([
    mammoth.extractRawText({ buffer }),
    mammoth.convertToHtml({ buffer }),
  ]);

  const text = normalizeText(rawTextResult.value || "");
  const html = htmlResult.value || "";
  const imageCount = (html.match(/<img\b/gi) || []).length;
  const paragraphCount = (text.match(/\n/g) || []).length + 1;
  const warnings = [...(rawTextResult.messages || []), ...(htmlResult.messages || [])]
    .map((m) => m.message)
    .filter(Boolean);

  return {
    text,
    html,
    stats: {
      imageCount,
      paragraphCount,
      charCount: text.length,
      warnings,
    },
  };
}

function normalizeText(text) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

module.exports = { extractTextFromBuffer, parseDocxBuffer, normalizeText };
