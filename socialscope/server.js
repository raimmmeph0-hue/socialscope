
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const dns = require("node:dns").promises;
const crypto = require("node:crypto");
const { URL } = require("node:url");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);

const TIKTOK_REDIRECT_URI =
  "https://socialscope-31ci.onrender.com/tiktok/callback";

// Minimal .env loader
try {
  const env = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
  for (const line of env.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
} catch (_) {}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function reply(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin"
  });
  res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
}

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// YOUTUBE
async function youtube(endpoint, params) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key || key === "your_youtube_data_api_v3_key") {
    throw fail("YouTube API is not configured yet.", 503);
  }

  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  Object.entries({ ...params, key }).forEach(([k, v]) =>
    url.searchParams.set(k, String(v))
  );

  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok) {
    throw fail(data?.error?.message || `YouTube API error (${response.status}).`, response.status);
  }

  return data;
}

async function getYoutubeProfile(input) {
  const handle = String(input || "").trim().replace(/^@/, "");
  if (!handle) throw fail("Enter a public YouTube channel name or handle.");

  const search = await youtube("search", {
    part: "snippet",
    type: "channel",
    q: handle,
    maxResults: 8
  });

  const candidates = search.items || [];
  if (!candidates.length) throw fail("No public YouTube channel matched that search.", 404);

  const match = candidates.find(item =>
    String(item.snippet?.customUrl || "").replace(/^@/, "").toLowerCase() === handle.toLowerCase()
  ) || candidates[0];

  const id = match.id?.channelId;
  if (!id) throw fail("YouTube did not return a channel ID.", 502);

  const channelResult = await youtube("channels", {
    part: "snippet,statistics,contentDetails",
    id
  });

  const channel = channelResult.items?.[0];
  if (!channel) throw fail("Channel details are unavailable.", 404);

  const uploadsId = channel.contentDetails?.relatedPlaylists?.uploads;
  let videos = [];

  if (uploadsId) {
    const playlist = await youtube("playlistItems", {
      part: "snippet,contentDetails",
      playlistId: uploadsId,
      maxResults: 12
    });

    videos = (playlist.items || []).map(item => {
      const videoId = item.contentDetails?.videoId;
      return {
        id: videoId,
        title: item.snippet?.title || "Untitled video",
        description: item.snippet?.description || "",
        publishedAt: item.contentDetails?.videoPublishedAt || item.snippet?.publishedAt || null,
        thumbnail: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || null,
        url: `https://www.youtube.com/watch?v=${videoId}`
      };
    }).filter(video => video.id);
  }

  const s = channel.snippet || {};
  const st = channel.statistics || {};

  return {
    platform: "YouTube",
    id: channel.id,
    username: s.customUrl || s.title || handle,
    displayName: s.title || "",
    bio: s.description || "",
    avatar: s.thumbnails?.high?.url || s.thumbnails?.medium?.url || null,
    createdAt: s.publishedAt || null,
    country: s.country || null,
    stats: {
      subscribers: st.hiddenSubscriberCount ? null : (st.subscriberCount ?? null),
      views: st.viewCount ?? null,
      videos: st.videoCount ?? null,
      hiddenSubscribers: Boolean(st.hiddenSubscriberCount)
    },
    videos,
    profileUrl: `https://www.youtube.com/channel/${channel.id}`,
    retrievedAt: new Date().toISOString(),
    source: "YouTube Data API v3"
  };
}

async function getYoutubeComments(videoId, count = 20) {
  if (!/^[A-Za-z0-9_-]{6,}$/.test(videoId || "")) {
    throw fail("That video ID is not valid.");
  }

  const data = await youtube("commentThreads", {
    part: "snippet",
    videoId,
    maxResults: Math.min(100, Math.max(1, Number(count) || 20)),
    order: "time",
    textFormat: "plainText"
  });

  return (data.items || []).map(item => {
    const c = item.snippet?.topLevelComment?.snippet || {};
    const commentId = item.snippet?.topLevelComment?.id || "";

    return {
      author: c.authorDisplayName || "YouTube user",
      text: c.textDisplay || "",
      publishedAt: c.publishedAt || null,
      updatedAt: c.updatedAt || null,
      likes: c.likeCount ?? null,
      url: `https://www.youtube.com/watch?v=${videoId}&lc=${commentId}`
    };
  });
}

// DOMAIN LOOKUP
function cleanDomain(input) {
  let value = String(input || "").trim();
  if (!value) throw fail("Enter a website domain, such as example.com.");
  if (!/^https?:\/\//i.test(value)) value = "https://" + value;

  let parsed;
  try {
    parsed = new URL(value);
  } catch (_) {
    throw fail("Enter a valid website address.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw fail("Only HTTP and HTTPS website domains are supported.");
  }

  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");

  if (!host || host.length > 253 || !host.includes(".") || !/^[a-z0-9.-]+$/.test(host)) {
    throw fail("Enter a public domain name.");
  }

  if (host === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) {
    throw fail("Enter a public domain name rather than an IP address or local host.");
  }

  return { host, url: parsed.origin };
}

async function lookupDomain(input) {
  const { host, url } = cleanDomain(input);

  const results = await Promise.allSettled([
    dns.resolve4(host),
    dns.resolve6(host),
    dns.resolveNs(host),
    dns.resolveCname(host)
  ]);

  const value = r => r.status === "fulfilled" ? r.value : [];

  return {
    domain: host,
    website: url,
    ipv4: value(results[0]),
    ipv6: value(results[1]),
    nameServers: value(results[2]),
    canonicalNames: value(results[3]),
    checkedAt: new Date().toISOString(),
    note: "These are public DNS records for the website domain."
  };
}

// SERVER
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  try {

    // TIKTOK LOGIN START

    
if (req.method === "GET" && url.pathname === "/tiktok/login") {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
console.log("TikTok key diagnostic:", {
  length: clientKey?.length,
  startsWithWhitespace: /^\s/.test(clientKey || ""),
  endsWithWhitespace: /\s$/.test(clientKey || "")
});
  console.log("TikTok key check:", {
    present: Boolean(clientKey),
    length: clientKey?.length,
    hasWhitespace: /\s/.test(clientKey || "")
  });

  if (!clientKey) {

        return reply(res, 503, {
          error: "TikTok Client Key is not configured."
        });
      }

      const state = crypto.randomBytes(32).toString("hex");

      res.setHeader(
        "Set-Cookie",
        `tiktok_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/tiktok; Max-Age=600`
      );

      const authUrl = new URL("https://www.tiktok.com/v2/auth/authorize/");

      authUrl.searchParams.set("client_key", clientKey);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", "user.info.basic");
      authUrl.searchParams.set("redirect_uri", TIKTOK_REDIRECT_URI);
      authUrl.searchParams.set("state", state);

      res.writeHead(302, { Location: authUrl.toString() });
      return res.end();
    }

    // TIKTOK LOGIN CALLBACK
    if (req.method === "GET" && url.pathname === "/tiktok/callback") {
      const cookies = Object.fromEntries(
        (req.headers.cookie || "")
          .split(";")
          .map(item => item.trim().split(/=(.*)/s).slice(0, 2))
          .filter(item => item.length === 2)
      );

      const savedState = cookies.tiktok_oauth_state || "";
      const returnedState = url.searchParams.get("state") || "";

      res.setHeader(
        "Set-Cookie",
        "tiktok_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/tiktok; Max-Age=0"
      );

      if (
        !savedState ||
        !returnedState ||
        savedState.length !== returnedState.length ||
        !crypto.timingSafeEqual(Buffer.from(savedState), Buffer.from(returnedState))
      ) {
        return reply(res, 400, {
          error: "TikTok login could not be verified. Please try again."
        });
      }

      if (url.searchParams.has("error")) {
        return reply(res, 400, {
          error: "TikTok authorization was not completed."
        });
      }

      const code = url.searchParams.get("code");
      const clientKey = process.env.TIKTOK_CLIENT_KEY;
      const clientSecret = process.env.TIKTOK_CLIENT_SECRET;

      if (!code || !clientKey || !clientSecret) {
        return reply(res, 400, {
          error: "Missing TikTok authorization code or server configuration."
        });
      }

      const tokenResponse = await fetch(
        "https://open.tiktokapis.com/v2/oauth/token/",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: new URLSearchParams({
            client_key: clientKey,
            client_secret: clientSecret,
            code,
            grant_type: "authorization_code",
            redirect_uri: TIKTOK_REDIRECT_URI
          })
        }
      );

      const tokenData = await tokenResponse.json();

      if (!tokenResponse.ok || !tokenData.access_token) {
        console.error("TikTok token exchange failed:", tokenData.error);
        return reply(res, 502, {
          error: "TikTok login could not be completed. Please try again."
        });
      }

      const profileResponse = await fetch(
        "https://open.tiktokapis.com/v2/user/info/?fields=display_name,avatar_url",
        {
          headers: {
            Authorization: `Bearer ${tokenData.access_token}`
          }
        }
      );

      const profileData = await profileResponse.json();

      if (!profileResponse.ok || profileData.error?.code !== "ok") {
        return reply(res, 502, {
          error: "Login succeeded, but TikTok profile information could not be retrieved."
        });
      }

      const profile = profileData.data?.user || {};

      const safeName = String(profile.display_name || "TikTok user").replace(
        /[&<>"']/g,
        char => ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;"
        })[char]
      );

      return reply(
        res,
        200,
        `<!DOCTYPE html>
        <html>
          <head>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>TikTok connected - SocialScope</title>
          </head>
          <body style="font-family:Arial;text-align:center;padding:50px;background:#10172a;color:white">
            <h1>TikTok connected!</h1>
            <p>Welcome, ${safeName}.</p>
            <p>Your TikTok login was successful.</p>
            <a href="/" style="color:#60a5fa">Return to SocialScope</a>
          </body>
        </html>`,
        "text/html; charset=utf-8"
      );
    }

    // HEALTH CHECK
    if (req.method === "GET" && url.pathname === "/api/health") {
      return reply(res, 200, {
        ok: true,
        youtubeConfigured: Boolean(
          process.env.YOUTUBE_API_KEY &&
          process.env.YOUTUBE_API_KEY !== "your_youtube_data_api_v3_key"
        ),
        tiktokConfigured: Boolean(
          process.env.TIKTOK_CLIENT_KEY &&
          process.env.TIKTOK_CLIENT_SECRET
        )
      });
    }

    // YOUTUBE PROFILE
    if (req.method === "GET" && url.pathname === "/api/youtube/profile") {
      return reply(res, 200, await getYoutubeProfile(url.searchParams.get("handle")));
    }

    // YOUTUBE COMMENTS
    if (req.method === "GET" && url.pathname === "/api/youtube/comments") {
      return reply(res, 200, {
        comments: await getYoutubeComments(
          url.searchParams.get("videoId"),
          url.searchParams.get("maxResults")
        )
      });
    }

    // DOMAIN LOOKUP
    if (req.method === "GET" && url.pathname === "/api/domain-lookup") {
      return reply(res, 200, await lookupDomain(url.searchParams.get("domain")));
    }

    if (url.pathname.startsWith("/api/")) {
      return reply(res, 404, { error: "Unknown API endpoint." });
    }

    // STATIC FILES
    const requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    const file = path.resolve(ROOT, requested);

    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      return reply(res, 404, "Not found", "text/plain; charset=utf-8");
    }

    const ext = path.extname(file);
    return reply(res, 200, fs.readFileSync(file), MIME[ext] || "application/octet-stream");

  } catch (error) {
    console.error(error);
    return reply(res, error.status || 500, {
      error: error.message || "Unexpected server error."
    });
  }
});

server.listen(PORT, () => {
  console.log(`SocialScope is running on port ${PORT}`);
});
