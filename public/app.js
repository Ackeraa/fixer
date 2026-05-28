const form = document.getElementById("check-form");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const submitBtn = document.getElementById("submit-btn");
let latestQuality = null;
let latestCorrespondence = null;

function renderResult(data) {
  const quality = data.quality || {};
  const corr = data.correspondence || {};

  const lines = [];
  lines.push("=== 基本信息 ===");
  lines.push(`讲义: ${data.meta?.lectureFileName || "-"}`);
  lines.push(`答案: ${data.meta?.answersFileName || "-"}`);
  lines.push(`模型: ${data.meta?.model || "-"}`);
  lines.push("");

  lines.push("=== 讲义质量 ===");
  lines.push(`总分: ${quality.overallScore ?? "-"}/10`);
  lines.push(`总评: ${quality.summary || "-"}`);
  if (Array.isArray(quality.issues) && quality.issues.length) {
    lines.push("问题列表:");
    quality.issues.forEach((it, i) => {
      lines.push(`${i + 1}. [${it.severity || "-"}/${it.category || "-"}] ${it.location || "-"}`);
      lines.push(`   问题: ${it.description || "-"}`);
      lines.push(`   建议: ${it.suggestion || "-"}`);
    });
  }

  lines.push("");
  lines.push("=== 答案对应性 ===");
  lines.push(`匹配率: ${corr.matchRate ?? "-"}%`);
  lines.push(`总评: ${corr.summary || "-"}`);
  if (Array.isArray(corr.criticalIssues) && corr.criticalIssues.length) {
    lines.push("关键问题:");
    corr.criticalIssues.forEach((it, i) => {
      lines.push(`${i + 1}. ${it.questionRef || "-"}: ${it.issue || "-"}`);
      lines.push(`   建议: ${it.suggestion || "-"}`);
    });
  }

  if (Array.isArray(corr.missingInAnswers) && corr.missingInAnswers.length) {
    lines.push("");
    lines.push("答案缺失题目: " + corr.missingInAnswers.join("；"));
  }

  resultEl.textContent = lines.join("\n");
}

function renderPartial() {
  renderResult({
    meta: { lectureFileName: "-", answersFileName: "-", model: "-" },
    quality: latestQuality || {},
    correspondence: latestCorrespondence || {},
  });
}

async function readStreamResponse(resp) {
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text || "流式请求失败");
  }
  if (!resp.body) {
    throw new Error("浏览器不支持流式读取");
  }

  const decoder = new TextDecoder("utf-8");
  const reader = resp.body.getReader();
  let buffer = "";
  let finalResult = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";

    for (const block of events) {
      const lines = block.split("\n");
      let eventName = "message";
      const dataLines = [];
      for (const line of lines) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) continue;

      const payload = JSON.parse(dataLines.join("\n"));
      if (eventName === "progress") {
        statusEl.textContent = payload.message || "处理中...";
      } else if (eventName === "partial") {
        if (payload.section === "quality") {
          latestQuality = payload.data;
        } else if (payload.section === "correspondence") {
          latestCorrespondence = payload.data;
        }
        statusEl.textContent = payload.message || "处理中...";
        renderPartial();
      } else if (eventName === "done") {
        finalResult = payload.result;
        statusEl.textContent = payload.message || "分析完成";
      } else if (eventName === "error") {
        throw new Error(payload.error || "分析失败");
      }
    }
  }

  if (!finalResult) {
    throw new Error("未收到最终结果，请重试");
  }
  return finalResult;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  resultEl.textContent = "";
  statusEl.textContent = "正在上传并分析，请稍候...";
  submitBtn.disabled = true;
  latestQuality = null;
  latestCorrespondence = null;

  const fd = new FormData(form);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);

  try {
    const resp = await fetch("/api/check-stream", {
      method: "POST",
      body: fd,
      signal: controller.signal,
    });
    const data = await readStreamResponse(resp);
    renderResult(data);
    statusEl.textContent = "分析完成";
  } catch (err) {
    statusEl.textContent = "分析失败";
    if (err.name === "AbortError") {
      resultEl.textContent = "请求超时（90秒），可能是模型服务不可达或响应过慢。";
    } else {
      resultEl.textContent = err.message;
    }
  } finally {
    clearTimeout(timeout);
    submitBtn.disabled = false;
  }
});
