const { chatJson } = require("./aiClient");

const SYSTEM_PROMPT = `你是一名英语讲义校对助手。

核心目标（必须优先完成）：
1. 找出所有可确定的拼写错误
2. 找出所有可确定的语法错误
3. 以上两类必须“尽量完整列出”，不要只列部分样例

其次目标（可选）：
- 再检查明显的用词、标点、格式问题

严格规则：
- 只基于给到的文本判断
- 不检查图片、音频、表格是否缺失
- 证据不足就不要报
- 每条问题必须包含：错误原文、建议改法、简短证据
- 相同错误在不同位置出现，按不同位置分别列出
- summary 中提到的问题数量，必须与 issues 实际条数一致

请用中文输出，严格返回 JSON，结构如下：
{
  "overallScore": 1-10 的整数,
  "summary": "一句话总评",
  "issues": [
    {
      "severity": "high|medium|low",
      "category": "格式|语言|逻辑|教学|完整性",
      "location": "题号或段落描述",
      "description": "问题描述（含错误原文与证据片段）",
      "suggestion": "修改建议"
    }
  ],
  "highlights": ["做得好的地方"]
}

输出约束：
- 优先输出拼写/语法问题
- issues 最多 12 条`;

async function checkLectureQuality(lectureDoc) {
  const lectureText = lectureDoc.text;
  const truncated =
    lectureText.length > 28000
      ? lectureText.slice(0, 28000) + "\n\n[文档已截断，仅分析前 28000 字符]"
      : lectureText;

  const userPrompt = `文档结构信息：
- 字符数：${lectureDoc.stats.charCount}
- 段落数：${lectureDoc.stats.paragraphCount}
- 解析警告：${lectureDoc.stats.warnings.length ? lectureDoc.stats.warnings.join(" | ") : "无"}

请检查以下学生用书/讲义内容：\n\n${truncated}`;
  const result = await chatJson(SYSTEM_PROMPT, userPrompt);
  return sanitizeLectureIssues(result);
}

const IGNORE_PATTERNS = [
  /photo|photos|图片|配图|看图|图[片文]|A-E|A\/B|A、B/i,
  /listen|listening|audio|音频|听力|录音/i,
  /表格未.*出现|无表格|缺少表格|table.*未.*出现/i,
  /complete the table/i,
  /exercise\s*\d+.*table/i,
  /table with the .* in the box/i,
  /无法作答|无法完成|不能作答/i,
];

function shouldIgnoreIssue(issue) {
  const location = `${issue?.location || ""}`;
  const description = `${issue?.description || ""}`;
  const suggestion = `${issue?.suggestion || ""}`;
  const blob = `${location} ${description} ${suggestion}`;

  const hasTableCue =
    /table|表格|complete the table|exercise\s*\d+/i.test(blob) &&
    /缺失|没有|未显示|无法作答|无法完成|不能作答|跳到\s*["']?\d+/i.test(blob);

  return hasTableCue || IGNORE_PATTERNS.some((re) => re.test(blob));
}

function sanitizeLectureIssues(result) {
  const normalized = result && typeof result === "object" ? result : {};
  const issues = Array.isArray(normalized.issues) ? normalized.issues : [];
  normalized.issues = issues.filter((it) => !shouldIgnoreIssue(it));
  return normalized;
}

module.exports = { checkLectureQuality };
