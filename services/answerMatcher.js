const { chatJson } = require("./aiClient");

const SYSTEM_PROMPT = `你是一名英语教学答案核验专家。用户会提供两份文档：
1. 学生用书/讲义（含题目）
2. 答案文档

请逐题比对答案是否与讲义题目对应，检查：
1. 题号是否一一对应，有无漏答、多答、错位
2. 答案内容是否与题目要求匹配（填空词、选择、判断对错等）
3. 答案格式是否与题目类型一致
4. 是否有明显错误或可疑答案

请用中文输出，严格返回 JSON，结构如下：
{
  "matchRate": 0-100 的整数，表示整体匹配度,
  "summary": "一句话总评",
  "matched": [
    {
      "questionRef": "题号或位置",
      "lectureSnippet": "讲义中该题简要描述",
      "answerSnippet": "答案中对应内容",
      "status": "match|mismatch|uncertain",
      "note": "说明（匹配可为空）"
    }
  ],
  "missingInAnswers": ["讲义有但答案没有的题"],
  "extraInAnswers": ["答案有但讲义没有的题"],
  "criticalIssues": [
    {
      "questionRef": "题号",
      "issue": "严重问题描述",
      "suggestion": "建议"
    }
  ]
}

matched 数组最多列出 30 条代表性题目；若题目很多，优先列出有问题或不确定的项。`;

async function verifyAnswers(lectureDoc, answerDoc) {
  const lectureText = lectureDoc.text;
  const answerText = answerDoc.text;
  const maxEach = 14000;
  const lecture =
    lectureText.length > maxEach
      ? lectureText.slice(0, maxEach) + "\n[讲义已截断]"
      : lectureText;
  const answers =
    answerText.length > maxEach
      ? answerText.slice(0, maxEach) + "\n[答案已截断]"
      : answerText;

  const userPrompt = `文档结构信息：
- 讲义：字符 ${lectureDoc.stats.charCount}，段落 ${lectureDoc.stats.paragraphCount}
- 答案：字符 ${answerDoc.stats.charCount}，段落 ${answerDoc.stats.paragraphCount}

## 学生用书/讲义\n\n${lecture}\n\n---\n\n## 答案文档\n\n${answers}`;
  return chatJson(SYSTEM_PROMPT, userPrompt);
}

module.exports = { verifyAnswers };
