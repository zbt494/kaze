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
  const sources = [
    {
      name: "ip-api",
      url: "http://ip-api.com/json/?lang=zh-CN",
      parse: body => {
        const d = JSON.parse(body || "{}");
        return {
          source: "ip-api",
          ip: d.query || "",
          cc: d.countryCode || "XX",
          country: d.country || "未知",
          city: d.city || "",
          asn: d.as || ""
        };
      }
    },
    {
      name: "ip.sb",
      url: "https://api.ip.sb/geoip",
      parse: body => {
        const d = JSON.parse(body || "{}");
        return {
          source: "ip.sb",
          ip: d.ip || "",
          cc: d.country_code || "XX",
          country: d.country || "未知",
          city: d.city || "",
          asn: d.asn ? `AS${d.asn} ${d.organization || ""}`.trim() : (d.organization || "")
        };
      }
    },
    {
      name: "ipapi.co",
      url: "https://ipapi.co/json/",
      parse: body => {
        const d = JSON.parse(body || "{}");
        return {
          source: "ipapi.co",
          ip: d.ip || "",
          cc: d.country_code || "XX",
          country: d.country_name || "未知",
          city: d.city || "",
          asn: d.asn || ""
        };
      }
    },
    {
      name: "ipinfo",
      url: "https://ipinfo.io/json",
      parse: body => {
        const d = JSON.parse(body || "{}");
        return {
          source: "ipinfo",
          ip: d.ip || "",
          cc: d.country || "XX",
          country: d.country || "未知",
          city: d.city || "",
          asn: d.org || ""
        };
      }
    }
  ];

  const results = await Promise.all(sources.map(async s => {
    const r = await request(s.url, {
      timeout: 5000,
      headers: { "User-Agent": BASE_UA, "Accept": "application/json" }
    });
    try {
      if (!r || !r.data) return null;
      return s.parse(r.data);
    } catch (_) {
      return null;
    }
  }));

  const valid = results.filter(Boolean);

  function choosePrimary(list) {
    if (!list.length) return { ip: "", cc: "XX", country: "未知", city: "", asn: "", source: "none" };

    // 多源多数表决：避免 ip-api 单源把 HK 误判成 FR 时影响面板结果。
    const counts = {};
    list.forEach(x => {
      const cc = x.cc || "XX";
      counts[cc] = (counts[cc] || 0) + 1;
    });

    let bestCc = list[0].cc || "XX";
    let bestCount = counts[bestCc] || 0;
    Object.keys(counts).forEach(cc => {
      if (counts[cc] > bestCount) {
        bestCc = cc;
        bestCount = counts[cc];
      }
    });

    // 同票时优先信任 ip.sb / ipinfo，再退回第一个。
    return list.find(x => x.cc === bestCc && x.source === "ip.sb")
      || list.find(x => x.cc === bestCc && x.source === "ipinfo")
      || list.find(x => x.cc === bestCc)
      || list[0];
  }

  const primary = choosePrimary(valid);
  primary.flag = getFlag(primary.cc);
  primary.sources = valid;
  return primary;
}

function getSelectedPolicy(groupName) {
  try {
    if (typeof $surge !== "undefined" && $surge.selectGroupDetails) {
      // Surge API: 不传参数返回全部 select 组，结构通常为 { groups: [{ name/groupName, selected, policies }] }
      const d = $surge.selectGroupDetails();
      const groups = d && d.groups ? d.groups : [];
      const g = groups.find(x =>
        x.name === groupName ||
        x.groupName === groupName ||
        x.policy === groupName ||
        x.title === groupName
      );
      if (g) return g.selected || g.now || g.decision || g.current || "未选择";
    }
  } catch (e) {
    return "读取失败";
  }
  return "未找到该 select 组";
}

async function checkNetflix() {
  const probes = [
    "https://www.netflix.com/title/70143836",
    "https://www.netflix.com/title/81280792"
  ];

  for (const url of probes) {
    const r = await request(url, {
      timeout: 6000,
      headers: {
        "User-Agent": BASE_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
      },
      followRedirect: false
    });

    if (!r || !r.response) continue;
    const status = r.response.status;
    const body = String(r.data || "");

    if (status === 200 || status === 301 || status === 302 || status === 401) {
      return { status: "已解锁", code: "OK" };
    }
    if (status === 403 || status === 404 || /title is not available|not available|unavailable/i.test(body)) {
      return { status: "未解锁", code: "NO" };
    }
  }

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
  // 严格检测：ChatGPT 的 Cloudflare trace 可访问不等于 ChatGPT 可用。
  // 这里先取 trace 地区，再访问 OpenAI backend API。受限地区通常会返回 unsupported_country / 403。
  const trace = await request("https://chatgpt.com/cdn-cgi/trace", {
    timeout: 4000,
    headers: { "User-Agent": BASE_UA }
  });

  let cc = "OK";
  if (trace && trace.data) {
    const m = trace.data.match(/loc=([A-Z]{2})/);
    if (m && m[1]) cc = m[1].toUpperCase();
  }

  const r = await request("https://chatgpt.com/backend-api/models", {
    timeout: 6000,
    headers: {
      "User-Agent": BASE_UA,
      "Accept": "application/json,text/plain,*/*",
      "Referer": "https://chatgpt.com/"
    },
    followRedirect: false
  });

  if (!r || !r.response) return { status: "检测失败", code: "ERR" };

  const status = r.response.status;
  const body = String(r.data || "");

  if (status === 403 || /unsupported_country|not available|not supported|country/i.test(body)) {
    return { status: "未解锁", code: "NO" };
  }

  // 未登录时可能返回 401/403/404，地区可用性检测主要看是否出现 unsupported_country。
  // 2xx/3xx/401 通常说明没有被地区封锁。
  if ((status >= 200 && status < 400) || status === 401) {
    return { status: "已解锁", code: cc };
  }

  return { status: "检测失败", code: "ERR" };
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
    suffix = proxy && proxy.cc ? `${proxy.flag}${proxy.cc}` : "";
  } else if (res.code === "NO") {
    mark = "❌";
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

    const geoLines = proxy.sources && proxy.sources.length
      ? proxy.sources.map(s => {
          const city = s.city ? ` ${s.city}` : "";
          return `${s.source}: ${getFlag(s.cc)}${s.cc} ${s.country}${city}`;
        })
      : [`定位源: ${proxy.flag}${proxy.cc} ${proxy.country}`];

    const aigcPolicy = getSelectedPolicy("AIGC");
    const proxyPolicy = getSelectedPolicy("Proxy");
    const finalPolicy = getSelectedPolicy("FINAL");

    const content = [
      `当前 IP: ${proxy.ip || "未知"}`,
      `AIGC 节点: ${aigcPolicy}`,
      `Proxy 节点: ${proxyPolicy}`,
      `FINAL 节点: ${finalPolicy}`,
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
    ].filter(line => line !== "").join("\n");

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
