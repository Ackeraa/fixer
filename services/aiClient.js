const OpenAI = require("openai");

function createClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("未配置 OPENAI_API_KEY，请在 .env 中设置");
  }

  const timeout = Number(process.env.OPENAI_TIMEOUT_MS || 45000);
  const options = { apiKey, timeout, maxRetries: 1 };
  if (process.env.OPENAI_BASE_URL) {
    options.baseURL = process.env.OPENAI_BASE_URL;
  }
  return new OpenAI(options);
}

function getModel() {
  return process.env.OPENAI_MODEL || "gpt-4o-mini";
}

async function chatJson(systemPrompt, userPrompt) {
  const client = createClient();
  let response;
  try {
    response = await client.chat.completions.create({
      model: getModel(),
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
  } catch (err) {
    const msg = err?.message || String(err);
    if (/timeout|ETIMEDOUT|aborted/i.test(msg)) {
      throw new Error("AI 请求超时，请检查模型服务状态或稍后重试");
    }
    throw new Error(`AI 请求失败: ${msg}`);
  }

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("AI 返回为空");
  }

  try {
    return JSON.parse(content);
  } catch {
    throw new Error("AI 返回不是合法 JSON");
  }
}

module.exports = { chatJson, getModel };
