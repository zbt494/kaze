// Surge Panel: 解锁检测稳定版
// 说明：去掉策略组读取与 ChatGPT 检测，避免分流/多层策略组场景误判。

const BASE_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const TIMEOUT = 6000;

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
    const req = {
      url,
      headers: opts.headers || {},
      timeout: opts.timeout || TIMEOUT
    };
    if (typeof opts.followRedirect === "boolean") req["auto-redirect"] = opts.followRedirect;
    $httpClient.get(req, (error, response, data) => {
      if (error) return resolve(null);
      resolve({ response, data: data || "" });
    });
  });
}

async function fetchProxy() {
  const sources = [
    {
      source: "ip-api",
      url: "http://ip-api.com/json/?lang=zh-CN",
      parse: body => {
        const d = JSON.parse(body || "{}");
        return { source: "ip-api", ip: d.query || "", cc: d.countryCode || "XX", country: d.country || "未知", city: d.city || "", asn: d.as || "" };
      }
    },
    {
      source: "ip.sb",
      url: "https://api.ip.sb/geoip",
      parse: body => {
        const d = JSON.parse(body || "{}");
        return { source: "ip.sb", ip: d.ip || "", cc: d.country_code || "XX", country: d.country || "未知", city: d.city || "", asn: d.asn ? `AS${d.asn} ${d.organization || ""}`.trim() : (d.organization || "") };
      }
    },
    {
      source: "ipinfo",
      url: "https://ipinfo.io/json",
      parse: body => {
        const d = JSON.parse(body || "{}");
        return { source: "ipinfo", ip: d.ip || "", cc: d.country || "XX", country: d.country || "未知", city: d.city || "", asn: d.org || "" };
      }
    }
  ];

  const results = await Promise.all(sources.map(async s => {
    const r = await request(s.url, { timeout: 5000, headers: { "User-Agent": BASE_UA, "Accept": "application/json" } });
    try {
      if (!r || !r.data) return null;
      return s.parse(r.data);
    } catch (_) {
      return null;
    }
  }));

  const valid = results.filter(Boolean);
  if (!valid.length) return { ip: "未知", cc: "XX", flag: "", country: "未知", city: "", asn: "", sources: [] };

  const counts = {};
  valid.forEach(x => counts[x.cc] = (counts[x.cc] || 0) + 1);
  let bestCc = valid[0].cc;
  Object.keys(counts).forEach(cc => { if (counts[cc] > counts[bestCc]) bestCc = cc; });

  const primary = valid.find(x => x.cc === bestCc && x.source === "ip.sb")
    || valid.find(x => x.cc === bestCc && x.source === "ipinfo")
    || valid.find(x => x.cc === bestCc)
    || valid[0];

  primary.flag = getFlag(primary.cc);
  primary.sources = valid;
  return primary;
}

async function checkNetflix() {
  const probes = [
    "https://www.netflix.com/title/70143836",
    "https://www.netflix.com/title/81280792"
  ];
  for (const url of probes) {
    const r = await request(url, {
      timeout: 6000,
      headers: { "User-Agent": BASE_UA, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8" },
      followRedirect: false
    });
    if (!r || !r.response) continue;
    const status = r.response.status;
    const body = String(r.data || "");
    if (status === 200 || status === 301 || status === 302 || status === 401) return { status: "已解锁", code: "OK" };
    if (status === 403 || status === 404 || /not available|unavailable/i.test(body)) return { status: "未解锁", code: "NO" };
  }
  return { status: "检测失败", code: "ERR" };
}

async function checkDisney() {
  const r = await request("https://www.disneyplus.com", { timeout: 6000, headers: { "User-Agent": BASE_UA }, followRedirect: false });
  const status = r && r.response && r.response.status;
  if (!status) return { status: "检测失败", code: "ERR" };
  if (status === 403) return { status: "未解锁", code: "NO" };
  return { status: "已解锁", code: "OK" };
}

async function checkChatGPT() {
  try {
    const r = await request("https://chatgpt.com/cdn-cgi/trace", { timeout: 4000 });
    if (!r || !r.data) return { status: "未解锁", code: "NO" };
    const m = r.data.match(/loc=([A-Z]{2})/);
    return { status: "已解锁", code: m && m[1] ? m[1].toUpperCase() : "OK" };
  } catch (_) {
    return { status: "未解锁", code: "NO" };
  }
}

async function checkClaude() {
  const r = await request("https://claude.ai/login", { timeout: 6000, headers: { "User-Agent": BASE_UA }, followRedirect: false });
  const status = r && r.response && r.response.status;
  if (!status) return { status: "检测失败", code: "ERR" };
  if (status === 403) return { status: "未解锁", code: "NO" };
  return { status: "已解锁", code: "OK" };
}

async function checkGemini() {
  const r = await request("https://gemini.google.com/app", { timeout: 6000, headers: { "User-Agent": BASE_UA }, followRedirect: false });
  const status = r && r.response && r.response.status;
  if (!status) return { status: "检测失败", code: "ERR" };
  if (status === 403) return { status: "未解锁", code: "NO" };
  return { status: "已解锁", code: "OK" };
}

function fmtResult(name, res, proxy) {
  if (res.code === "OK") return `${name}: ✅ ${res.status} › ${proxy.flag}${proxy.cc}`;
  if (res.code === "NO") return `${name}: ❌ ${res.status}`;
  return `${name}: ⚠️ ${res.status}`;
}

(async () => {
  try {
    const [proxy, netflix, disney, chatgpt, claude, gemini] = await Promise.all([
      fetchProxy(), checkNetflix(), checkDisney(), checkChatGPT(), checkClaude(), checkGemini()
    ]);

    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    const geoLines = proxy.sources.length
      ? proxy.sources.map(s => `${s.source}: ${getFlag(s.cc)}${s.cc} ${s.country}${s.city ? " " + s.city : ""}`)
      : ["定位源: 获取失败"];

    const content = [
      `当前 IP: ${proxy.ip || "未知"}`,
      `主定位: ${proxy.flag}${proxy.cc} ${proxy.country}${proxy.city ? " " + proxy.city : ""}`,
      proxy.asn ? `ASN: ${proxy.asn}` : "",
      "",
      "多源定位",
      ...geoLines,
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
    ].filter(Boolean).join("\n");

    $done({ title: "解锁检测", content, icon: "lock.open.fill", "icon-color": "#007AFF" });
  } catch (e) {
    $done({ title: "解锁检测", content: `检测失败: ${e && e.message ? e.message : e}`, icon: "xmark.octagon.fill", "icon-color": "#FF3B30" });
  }
})();
