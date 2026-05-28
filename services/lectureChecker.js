const { chatJson } = require("./aiClient");

const SYSTEM_PROMPT = `你是一名英语教学讲义质检专家。请检查学生用书/讲义文档的质量。

非常重要的判定规则（必须遵守）：
1. 只允许基于“提供的文本内容”下结论，禁止脑补版面、图片、音频、外部教材。
2. 以下问题一律不要输出到 issues（直接忽略）：
   - “photos/图片/配图缺失”类判断
   - “listen/audio/听力资源缺失”类判断
   - “表格未显示/表格缺失”类判断（仅因纯文本解析看不到版式而产生）
   - 基于“Complete the table ...”推导出的“后续题无法作答”链式判断
3. high 级问题必须满足：有明确文本证据，且会直接导致学生无法作答或答案错误。
4. 每个问题都要给出简短证据片段（原文摘录不超过20词）放在 description 里。
5. 若证据不足，宁可不报；避免误报。

关注维度：
1. 格式与排版：题号是否连续、空白填空是否合理、表格/栏目是否完整
2. 语言质量：语法、拼写、标点、用词是否适合 A2 级别英语学习者
3. 内容逻辑：题目说明是否清晰、选项/词库是否齐全、阅读材料与题目是否匹配
4. 教学合理性：难度是否一致、是否有歧义或无法作答的题目
5. 完整性：是否有明显缺页、缺题、重复题

请用中文输出，严格返回 JSON，结构如下：
{
  "overallScore": 1-10 的整数,
  "summary": "一句话总评",
  "issues": [
    {
      "severity": "high|medium|low",
      "category": "格式|语言|逻辑|教学|完整性",
      "location": "题号或段落描述",
      "description": "问题描述（含证据片段：...）",
      "suggestion": "修改建议"
    }
  ],
  "highlights": ["做得好的地方"]
}

输出约束：
- issues 最多 8 条，仅保留最确定的问题
- 若没有明确高风险，high 数量可为 0`;

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
