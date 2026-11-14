const $ = id => document.getElementById(id);
let activeProfile = null;

function dateText(value) {
  if (!value) return "Not provided";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not provided" : date.toLocaleString();
}
function numberText(value) {
  return value === null || value === undefined ? "Hidden / unavailable" : Number(value).toLocaleString();
}
function notice(message, error = false) {
  $("notice").textContent = message;
  $("notice").className = "notice" + (error ? " error" : "");
}
async function request(url) {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
function historyKey(profile) { return `ss-history:${profile.platform}:${profile.id}`; }
function readHistory(profile) {
  try { return JSON.parse(localStorage.getItem(historyKey(profile)) || "[]"); } catch { return []; }
}
function recordSnapshot(profile) {
  const key = historyKey(profile);
  const history = readHistory(profile);
  const now = new Date().toISOString();
  const current = { observedAt: now, displayName: profile.displayName, username: profile.username, bio: profile.bio, avatar: profile.avatar };
  const previous = history.length ? history[history.length - 1].snapshot : null;
  if (!previous) {
    history.push({ observedAt: now, title: "First SocialScope observation", detail: "First snapshot saved in this browser. This is not the account creation date.", snapshot: current });
  } else {
    const changes = [];
    if (previous.displayName !== current.displayName) changes.push("display name changed");
    if (previous.username !== current.username) changes.push("username/handle changed");
    if (previous.bio !== current.bio) changes.push("bio changed");
    if (previous.avatar !== current.avatar) changes.push("profile image changed");
    if (changes.length) history.push({ observedAt: now, title: "Profile change observed", detail: changes.join(", ") + ". This is when SocialScope detected the difference, not necessarily when the edit occurred.", snapshot: current });
    else history.push({ observedAt: now, title: "Profile checked", detail: "No changes detected in the fields SocialScope can compare.", snapshot: current });
  }
  // Keep the latest 100 observations per profile.
  localStorage.setItem(key, JSON.stringify(history.slice(-100)));
  return history.slice(-100);
}
function renderTimeline(history) {
  $("timeline").innerHTML = "";
  if (!history.length) {
    $("timeline").innerHTML = '<p class="subtle">No observations saved yet.</p>';
    return;
  }
  [...history].reverse().forEach(event => {
    const node = document.createElement("article");
    node.className = "event";
    const title = document.createElement("h4");
    title.textContent = event.title;
    const detail = document.createElement("p");
    detail.textContent = event.detail;
    const time = document.createElement("time");
    time.textContent = dateText(event.observedAt);
    node.append(title, detail, time);
    $("timeline").append(node);
  });
}
function stat(label, value) {
  const node = document.createElement("div");
  node.className = "stat";
  const b = document.createElement("b"); b.textContent = numberText(value);
  const span = document.createElement("span"); span.textContent = label;
  node.append(b, span); return node;
}
function renderProfile(profile) {
  activeProfile = profile;
  $("profileSection").classList.remove("hidden");
  $("avatar").src = profile.avatar || "";
  $("avatar").style.visibility = profile.avatar ? "visible" : "hidden";
  $("displayName").textContent = profile.displayName || "Unnamed channel";
  $("username").textContent = profile.username ? "@" + profile.username.replace(/^@/, "") : "";
  $("bio").textContent = profile.bio || "No public description provided.";
  $("profileLink").href = profile.profileUrl;
  $("accountId").textContent = profile.id || "Unavailable";
  $("createdAt").textContent = dateText(profile.createdAt);
  $("retrievedAt").textContent = dateText(profile.retrievedAt);
  $("stats").replaceChildren(
    stat("SUBSCRIBERS", profile.stats.subscribers),
    stat("CHANNEL VIEWS", profile.stats.views),
    stat("PUBLIC VIDEOS", profile.stats.videos)
  );
  $("videoCount").textContent = `${profile.videos.length} returned`;
  $("videos").innerHTML = "";
  if (!profile.videos.length) $("videos").innerHTML = '<p class="subtle">No public uploads were returned.</p>';
  profile.videos.forEach(video => {
    const card = document.createElement("article"); card.className = "video";
    const img = document.createElement("img"); img.src = video.thumbnail || ""; img.alt = ""; img.loading = "lazy";
    const body = document.createElement("div");
    const title = document.createElement("h3"); title.textContent = video.title;
    const date = document.createElement("time"); date.textContent = dateText(video.publishedAt);
    const actions = document.createElement("div"); actions.className = "video-actions";
    const open = document.createElement("a"); open.href = video.url; open.target = "_blank"; open.rel = "noopener noreferrer"; open.textContent = "Watch video ↗";
    const comments = document.createElement("button"); comments.textContent = "View public comments";
    comments.addEventListener("click", () => loadComments(video.id));
    actions.append(open, comments); body.append(title, date, actions); card.append(img, body); $("videos").append(card);
  });
  renderTimeline(recordSnapshot(profile));
}
async function searchProfile() {
  const platform = $("platform").value;
  const handle = $("handle").value.trim();
  if (!handle) { notice("Enter a public username or handle first.", true); $("handle").focus(); return; }
  if (platform !== "youtube") {
    notice(`${platform[0].toUpperCase() + platform.slice(1)} is not connected in this build. It needs its own approved API credentials and permissions.`, true);
    return;
  }
  $("searchBtn").disabled = true; $("searchBtn").textContent = "Searching…";
  notice("Searching the official YouTube Data API…");
  try {
    const profile = await request(`/api/youtube/profile?handle=${encodeURIComponent(handle)}`);
    renderProfile(profile);
    notice(`Loaded public channel data from ${profile.source}.`);
    $("profileSection").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) { notice(error.message, true); }
  finally { $("searchBtn").disabled = false; $("searchBtn").innerHTML = 'Search profile <b>→</b>'; }
}
async function loadComments(videoId) {
  $("commentsList").textContent = "Loading public comments…";
  $("commentsDialog").showModal();
  try {
    const result = await request(`/api/youtube/comments?videoId=${encodeURIComponent(videoId)}&maxResults=30`);
    $("commentsList").innerHTML = "";
    if (!result.comments.length) $("commentsList").textContent = "No public comments were returned for this video.";
    result.comments.forEach(comment => {
      const item = document.createElement("article"); item.className = "comment";
      const author = document.createElement("strong"); author.textContent = comment.author;
      const body = document.createElement("p"); body.textContent = comment.text;
      const date = document.createElement("time"); date.textContent = dateText(comment.publishedAt);
      const link = document.createElement("a"); link.href = comment.url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = "Open comment ↗";
      item.append(author, body, date, link); $("commentsList").append(item);
    });
  } catch (error) { $("commentsList").textContent = error.message; }
}
async function lookupDomain() {
  const domain = $("domainInput").value.trim();
  if (!domain) { $("dnsResult").textContent = "Enter a website domain first."; return; }
  $("dnsBtn").disabled = true; $("dnsBtn").textContent = "Looking up…";
  $("dnsResult").textContent = "Checking public DNS records…";
  try {
    const result = await request(`/api/domain-lookup?domain=${encodeURIComponent(domain)}`);
    const rows = [
      ["IPv4 A records", result.ipv4],
      ["IPv6 AAAA records", result.ipv6],
      ["Name servers", result.nameServers],
      ["Canonical names", result.canonicalNames]
    ];
    $("dnsResult").innerHTML = "";
    const heading = document.createElement("h3"); heading.textContent = result.domain; $("dnsResult").append(heading);
    rows.forEach(([label, values]) => {
      const row = document.createElement("div"); row.className = "dns-row";
      const title = document.createElement("strong"); title.textContent = label + ": ";
      const value = document.createElement("span"); value.textContent = values.length ? values.join(", ") : "No record returned";
      row.append(title, value); $("dnsResult").append(row);
    });
    const checked = document.createElement("p"); checked.className = "micro"; checked.textContent = "Checked " + dateText(result.checkedAt) + ". " + result.note;
    $("dnsResult").append(checked);
  } catch (error) { $("dnsResult").textContent = error.message; }
  finally { $("dnsBtn").disabled = false; $("dnsBtn").textContent = "Look up domain"; }
}
$("searchBtn").addEventListener("click", searchProfile);
$("handle").addEventListener("keydown", e => { if (e.key === "Enter") searchProfile(); });
$("dnsBtn").addEventListener("click", lookupDomain);
$("domainInput").addEventListener("keydown", e => { if (e.key === "Enter") lookupDomain(); });
$("closeDialog").addEventListener("click", () => $("commentsDialog").close());
$("clearHistory").addEventListener("click", () => {
  if (!activeProfile) return;
  if (confirm("Delete this profile's locally saved SocialScope observations?")) {
    localStorage.removeItem(historyKey(activeProfile)); renderTimeline([]);
  }
});
$("platform").addEventListener("change", () => {
  const p = $("platform").value;
  $("apiHint").textContent = p === "youtube"
    ? "YouTube requires a Google Cloud project with YouTube Data API v3 enabled and an API key."
    : "This platform is not connected yet. Use only approved API access; no login cookies or scraping are used.";
});
request("/api/health").then(health => {
  notice(health.youtubeConfigured
    ? "Ready. YouTube API key detected. Search a public channel."
    : "Server is running. Add a YouTube Data API key to .env to enable live channel search.");
}).catch(() => notice("Server connection unavailable. Start SocialScope with: npm start", true));
