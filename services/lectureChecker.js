const { chatJson } = require("./aiClient");

const SYSTEM_PROMPT = `你是一名英语教学讲义质检专家。请检查学生用书/讲义文档的质量。

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
      "description": "问题描述",
      "suggestion": "修改建议"
    }
  ],
  "highlights": ["做得好的地方"]
}`;

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
  return chatJson(SYSTEM_PROMPT, userPrompt);
}

module.exports = { checkLectureQuality };
