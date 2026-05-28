const form = document.getElementById("check-form");
const statusEl = document.getElementById("status");
const timelineEl = document.getElementById("timeline");
const resultEl = document.getElementById("result");
const submitBtn = document.getElementById("submit-btn");
const logoutBtn = document.getElementById("logout-btn");

let latestQuality = null;
let latestCorrespondence = null;
const timelineSteps = ["upload_received", "parsing", "parsed", "quality_done", "done"];

function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function severityBadge(sev) {
  const key = (sev || "low").toLowerCase();
  const label = key === "high" ? "高风险" : key === "medium" ? "中风险" : "低风险";
  return `<span class="badge ${key}">${label}</span>`;
}

function renderTimeline(current) {
  const idx = timelineSteps.indexOf(current);
  const html = timelineSteps
    .map((s, i) => {
      const cls = i < idx ? "step done" : i === idx ? "step active" : "step";
      const labelMap = {
        upload_received: "文件接收",
        parsing: "解析文档",
        parsed: "结构完成",
        quality_done: "讲义质检",
        done: "答案核验",
      };
      return `<span class="${cls}">${labelMap[s]}</span>`;
    })
    .join("");
  timelineEl.innerHTML = html;
}

function renderResult(data) {
  const meta = data.meta || {};
  const quality = data.quality || {};
  const corr = data.correspondence || {};

  const score = Number(quality.overallScore || 0);
  const matchRate = Number(corr.matchRate || 0);
  const issues = Array.isArray(quality.issues) ? quality.issues : [];
  const critical = Array.isArray(corr.criticalIssues) ? corr.criticalIssues : [];
  const missing = Array.isArray(corr.missingInAnswers) ? corr.missingInAnswers : [];
  const extra = Array.isArray(corr.extraInAnswers) ? corr.extraInAnswers : [];

  const issuesHtml = issues.length
    ? `<ul class="list">${issues
        .slice(0, 10)
        .map(
          (it) => `<li>${severityBadge(it.severity)} <b>${escapeHtml(it.location || "位置未标注")}</b><br>${escapeHtml(it.description || "")}<br><span class="muted">建议：${escapeHtml(it.suggestion || "-")}</span></li>`
        )
        .join("")}</ul>`
    : `<p class="muted">未发现明显问题。</p>`;

  const criticalHtml = critical.length
    ? `<ul class="list">${critical
        .slice(0, 10)
        .map(
          (it) => `<li><b>${escapeHtml(it.questionRef || "题号未标注")}</b>：${escapeHtml(it.issue || "-")}<br><span class="muted">建议：${escapeHtml(it.suggestion || "-")}</span></li>`
        )
        .join("")}</ul>`
    : `<p class="muted">未发现关键错配。</p>`;

  resultEl.innerHTML = `
    <section class="metrics">
      <article class="metric"><div class="label">讲义质量分</div><div class="value">${score || "-"}<span class="muted">/10</span></div></article>
      <article class="metric"><div class="label">答案匹配率</div><div class="value">${matchRate || "-"}<span class="muted">%</span></div></article>
      <article class="metric"><div class="label">讲义图片数</div><div class="value">${meta.lectureImageCount ?? "-"}</div></article>
      <article class="metric"><div class="label">模型</div><div class="value" style="font-size:14px">${escapeHtml(meta.model || "-")}</div></article>
    </section>

    <section class="grid">
      <article class="panel">
        <h3>讲义质量评估</h3>
        <p>${escapeHtml(quality.summary || "暂无总评")}</p>
        <div class="progress"><i style="width:${Math.max(0, Math.min(100, score * 10))}%"></i></div>
        ${issuesHtml}
      </article>

      <article class="panel">
        <h3>答案对应性评估</h3>
        <p>${escapeHtml(corr.summary || "暂无总评")}</p>
        <div class="progress"><i style="width:${Math.max(0, Math.min(100, matchRate))}%"></i></div>
        ${criticalHtml}
      </article>
    </section>

    <section class="grid">
      <article class="panel">
        <h3>答案缺失题目</h3>
        ${missing.length ? `<ul class="list">${missing.slice(0, 20).map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : `<p class="muted">无</p>`}
      </article>
      <article class="panel">
        <h3>答案多余题目</h3>
        ${extra.length ? `<ul class="list">${extra.slice(0, 20).map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : `<p class="muted">无</p>`}
      </article>
    </section>
  `;
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
        renderTimeline(payload.step || "parsing");
      } else if (eventName === "partial") {
        if (payload.section === "quality") {
          latestQuality = payload.data;
          renderTimeline("quality_done");
        } else if (payload.section === "correspondence") {
          latestCorrespondence = payload.data;
        }
        statusEl.textContent = payload.message || "处理中...";
        renderPartial();
      } else if (eventName === "done") {
        finalResult = payload.result;
        statusEl.textContent = payload.message || "分析完成";
        renderTimeline("done");
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
  resultEl.innerHTML = "";
  timelineEl.innerHTML = "";
  statusEl.textContent = "正在上传并分析，请稍候...";
  submitBtn.disabled = true;
  latestQuality = null;
  latestCorrespondence = null;
  renderTimeline("upload_received");

  const fd = new FormData(form);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

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
      resultEl.innerHTML = `<p class="muted">请求超时（120秒），模型服务可能不可达或响应过慢。</p>`;
    } else {
      resultEl.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
    }
  } finally {
    clearTimeout(timeout);
    submitBtn.disabled = false;
  }
});

logoutBtn?.addEventListener("click", async () => {
  try {
    await fetch("/api/logout", { method: "POST" });
  } finally {
    window.location.href = "/login";
  }
});
