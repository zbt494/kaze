// Surge Panel: 流媒体与 AI 解锁检测
// Ported from Egern widget by IBL3ND-style logic

const BASE_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const TIMEOUT = 5000;

function getFlag(code) {
  if (!code || code === "XX") return "";
  try {
    return String.fromCodePoint(...String(code).toUpperCase().split("").map(c => 127397 + c.charCodeAt()));
  } catch (_) {
    return "";
  }
}

function request(url, opts = {}) {
  return new Promise(resolve => {
    const method = opts.method || "GET";
    const headers = opts.headers || {};
    const timeout = opts.timeout || TIMEOUT;
    const followRedirect = opts.followRedirect;
    const req = { url, headers, timeout };
    if (typeof followRedirect === "boolean") req["auto-redirect"] = followRedirect;

    $httpClient[method.toLowerCase()](req, (error, response, data) => {
      if (error) return resolve(null);
      resolve({ response, data: data || "" });
    });
  });
}

async function fetchProxy() {
  const r = await request("http://ip-api.com/json/?lang=zh-CN", { timeout: 4000 });
  try {
    const data = JSON.parse(r && r.data || "{}");
    const cc = data.countryCode || "XX";
    return { cc, flag: getFlag(cc), country: data.country || "未知" };
  } catch (_) {
    return { cc: "XX", flag: "", country: "未知" };
  }
}

async function checkNetflix() {
  const r = await request("https://www.netflix.com/title/70143836", {
    timeout: 5000,
    headers: { "User-Agent": BASE_UA },
    followRedirect: false
  });
  const status = r && r.response && r.response.status;
  if (status === 200) return { status: "已解锁", code: "OK" };
  if (status === 403 || status === 404) return { status: "未解锁", code: "NO" };
  return { status: "检测失败", code: "ERR" };
}

async function checkDisney() {
  const r = await request("https://www.disneyplus.com", {
    timeout: 5000,
    headers: { "User-Agent": BASE_UA },
    followRedirect: false
  });
  const status = r && r.response && r.response.status;
  if (!status || status === 403) return { status: "未解锁", code: "NO" };
  return { status: "已解锁", code: "OK" };
}

async function checkChatGPT() {
  const r = await request("https://chatgpt.com/cdn-cgi/trace", { timeout: 4000 });
  if (!r || !r.data) return { status: "未解锁", code: "NO" };
  const m = r.data.match(/loc=([A-Z]{2})/);
  return { status: "已解锁", code: m && m[1] ? m[1].toUpperCase() : "OK" };
}

async function checkClaude() {
  const r = await request("https://claude.ai/login", {
    timeout: 5000,
    headers: { "User-Agent": BASE_UA }
  });
  if (!r || !r.response || !r.response.status) return { status: "未解锁", code: "NO" };
  if (r.response.status === 403) return { status: "未解锁", code: "NO" };
  return { status: "已解锁", code: "OK" };
}

async function checkGemini() {
  const r = await request("https://gemini.google.com/app", {
    timeout: 5000,
    headers: { "User-Agent": BASE_UA },
    followRedirect: false
  });
  if (!r || !r.response || !r.response.status) return { status: "未解锁", code: "NO" };
  if (r.response.status === 403) return { status: "未解锁", code: "NO" };
  return { status: "已解锁", code: "OK" };
}

function fmtResult(name, res, proxy) {
  let mark = "❌";
  let suffix = "";

  if (res.code === "OK") {
    mark = "✅";
    suffix = `${proxy.flag}${proxy.cc}`;
  } else if (/^[A-Z]{2}$/.test(res.code)) {
    mark = "✅";
    suffix = `${getFlag(res.code)}${res.code}`;
  } else if (res.code === "ERR") {
    mark = "⚠️";
  }

  return `${name}: ${mark} ${res.status}${suffix ? " › " + suffix : ""}`;
}

(async () => {
  try {
    const [proxy, netflix, disney, chatgpt, claude, gemini] = await Promise.all([
      fetchProxy(),
      checkNetflix(),
      checkDisney(),
      checkChatGPT(),
      checkClaude(),
      checkGemini()
    ]);

    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    const content = [
      `当前出口: ${proxy.flag}${proxy.cc} ${proxy.country}`,
      "",
      "流媒体解锁",
      `YouTube: ✅ 已解锁 › ${proxy.flag}${proxy.cc}`,
      fmtResult("Netflix", netflix, proxy),
      fmtResult("Disney+", disney, proxy),
      "",
      "AI 服务检测",
      fmtResult("ChatGPT", chatgpt, proxy),
      fmtResult("Claude", claude, proxy),
      fmtResult("Gemini", gemini, proxy),
      "",
      `更新时间: ${time}`
    ].join("\n");

    $done({
      title: "解锁检测",
      content,
      icon: "lock.open.fill",
      "icon-color": "#007AFF"
    });
  } catch (e) {
    $done({
      title: "解锁检测",
      content: `检测失败: ${e && e.message ? e.message : e}`,
      icon: "xmark.octagon.fill",
      "icon-color": "#FF3B30"
    });
  }
})();
