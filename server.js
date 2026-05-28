require("dotenv").config();

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const { parseDocxBuffer } = require("./services/docxParser");
const { checkLectureQuality } = require("./services/lectureChecker");
const { verifyAnswers } = require("./services/answerMatcher");
const { getModel } = require("./services/aiClient");

const app = express();
const PORT = process.env.PORT || 3000;
const LOGIN_USERNAME = "lly";
const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD || "";
const SESSION_COOKIE = "fixer_auth";
const sessions = new Map();

const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== ".docx") {
      return cb(new Error("仅支持 .docx 文件"));
    }
    cb(null, true);
  },
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public"), { index: false }));

function parseCookies(req) {
  const cookieHeader = req.headers.cookie || "";
  const out = {};
  for (const pair of cookieHeader.split(";")) {
    const [k, ...rest] = pair.trim().split("=");
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join("=") || "");
  }
  return out;
}

function isAuthenticated(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return false;
  const expiresAt = sessions.get(token);
  if (!expiresAt || expiresAt < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function requireAuth(req, res, next) {
  if (isAuthenticated(req)) return next();
  return res.status(401).json({ error: "未登录或登录已过期" });
}

app.get("/", (req, res) => {
  const page = isAuthenticated(req) ? "index.html" : "login.html";
  res.sendFile(path.join(__dirname, "public", page));
});

app.get("/login", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!LOGIN_PASSWORD) {
    return res.status(500).json({ error: "服务端未配置 LOGIN_PASSWORD" });
  }
  if (username !== LOGIN_USERNAME || password !== LOGIN_PASSWORD) {
    return res.status(401).json({ error: "用户名或密码错误" });
  }

  const token = crypto.randomBytes(24).toString("hex");
  const ttlMs = 12 * 60 * 60 * 1000;
  sessions.set(token, Date.now() + ttlMs);

  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${Math.floor(
      ttlMs / 1000
    )}; SameSite=Lax`
  );
  return res.json({ ok: true, username: LOGIN_USERNAME });
});

app.post("/api/logout", (req, res) => {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) sessions.delete(token);
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`
  );
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  res.json({ authenticated: isAuthenticated(req), username: LOGIN_USERNAME });
});

function writeSseEvent(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    model: getModel(),
    baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    timeoutMs: Number(process.env.OPENAI_TIMEOUT_MS || 45000),
    hasApiKey: Boolean(process.env.OPENAI_API_KEY),
  });
});

app.post(
  "/api/check-stream",
  requireAuth,
  upload.fields([
    { name: "lecture", maxCount: 1 },
    { name: "answers", maxCount: 1 },
  ]),
  async (req, res) => {
    const startedAt = Date.now();
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    try {
      writeSseEvent(res, "progress", { step: "upload_received", message: "已接收文件，准备解析..." });

      const lectureFile = req.files?.lecture?.[0];
      const answersFile = req.files?.answers?.[0];

      if (!lectureFile || !answersFile) {
        writeSseEvent(res, "error", { error: "请同时上传讲义（lecture）和答案（answers）两个 .docx 文件" });
        return res.end();
      }

      writeSseEvent(res, "progress", { step: "parsing", message: "正在解析 Word 文档..." });
      const [lectureDoc, answerDoc] = await Promise.all([
        parseDocxBuffer(lectureFile.buffer),
        parseDocxBuffer(answersFile.buffer),
      ]);

      if (!lectureDoc.text.trim() || !answerDoc.text.trim()) {
        writeSseEvent(res, "error", { error: "无法从文档中提取有效文本" });
        return res.end();
      }

      writeSseEvent(res, "progress", {
        step: "parsed",
        message: "文档解析完成，开始讲义质量检查...",
        meta: {
          lectureCharCount: lectureDoc.stats.charCount,
          answersCharCount: answerDoc.stats.charCount,
          lectureImageCount: lectureDoc.stats.imageCount,
          answersImageCount: answerDoc.stats.imageCount,
        },
      });

      const quality = await checkLectureQuality(lectureDoc);
      writeSseEvent(res, "partial", {
        section: "quality",
        message: "讲义质量检查完成，开始答案对应核验...",
        data: quality,
      });

      const correspondence = await verifyAnswers(lectureDoc, answerDoc);
      const result = {
        meta: {
          lectureFileName: lectureFile.originalname,
          answersFileName: answersFile.originalname,
          lectureCharCount: lectureDoc.stats.charCount,
          answersCharCount: answerDoc.stats.charCount,
          lectureImageCount: lectureDoc.stats.imageCount,
          answersImageCount: answerDoc.stats.imageCount,
          model: getModel(),
        },
        quality,
        correspondence,
      };

      console.log(
        `[check-stream] done in ${Date.now() - startedAt}ms lecture="${lectureFile.originalname}" answers="${answersFile.originalname}"`
      );
      writeSseEvent(res, "done", { message: "分析完成", result });
      res.end();
    } catch (err) {
      console.error(
        `[check-stream] failed in ${Date.now() - startedAt}ms:`,
        err?.message || err
      );
      writeSseEvent(res, "error", { error: err.message || "检查失败，请稍后重试" });
      res.end();
    }
  }
);

app.post(
  "/api/check",
  requireAuth,
  upload.fields([
    { name: "lecture", maxCount: 1 },
    { name: "answers", maxCount: 1 },
  ]),
  async (req, res) => {
    const startedAt = Date.now();
    try {
      const lectureFile = req.files?.lecture?.[0];
      const answersFile = req.files?.answers?.[0];

      if (!lectureFile || !answersFile) {
        return res.status(400).json({
          error: "请同时上传讲义（lecture）和答案（answers）两个 .docx 文件",
        });
      }

      const [lectureDoc, answerDoc] = await Promise.all([
        parseDocxBuffer(lectureFile.buffer),
        parseDocxBuffer(answersFile.buffer),
      ]);

      if (!lectureDoc.text.trim() || !answerDoc.text.trim()) {
        return res.status(400).json({ error: "无法从文档中提取有效文本" });
      }

      const [quality, correspondence] = await Promise.all([
        checkLectureQuality(lectureDoc),
        verifyAnswers(lectureDoc, answerDoc),
      ]);

      console.log(
        `[check] done in ${Date.now() - startedAt}ms lecture="${lectureFile.originalname}" answers="${answersFile.originalname}"`
      );

      res.json({
        meta: {
          lectureFileName: lectureFile.originalname,
          answersFileName: answersFile.originalname,
          lectureCharCount: lectureDoc.stats.charCount,
          answersCharCount: answerDoc.stats.charCount,
          lectureImageCount: lectureDoc.stats.imageCount,
          answersImageCount: answerDoc.stats.imageCount,
          model: getModel(),
        },
        quality,
        correspondence,
      });
    } catch (err) {
      console.error(
        `[check] failed in ${Date.now() - startedAt}ms:`,
        err?.message || err
      );
      res.status(500).json({
        error: err.message || "检查失败，请稍后重试",
      });
    }
  }
);

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `上传错误: ${err.message}` });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`讲义检查服务已启动: http://localhost:${PORT}`);
});
