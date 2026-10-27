const API_BASES = [
  "https://api.reedstreams.link",
  "https://reedstreams.to",
  "https://reedstreams.st"
];
const MATCHES_CACHE_KEY = "ss_matches_cache_v1";
const MATCHES_CACHE_TTL = 60 * 1000;

const noticeEl = document.getElementById("importantNotice");
const noticeCloseBtn = document.getElementById("noticeClose");

if (noticeEl) {
  if (localStorage.getItem("gkNoticeClosed") === "1") {
    noticeEl.classList.add("hidden");
  }
  if (noticeCloseBtn) {
    noticeCloseBtn.addEventListener("click", () => {
      noticeEl.classList.add("hidden");
      localStorage.setItem("gkNoticeClosed", "1");
    });
  }
}

const playerFrame = document.getElementById("playerFrame");
const channelsListEl = document.getElementById("channelsList");
const matchTitleEl = document.getElementById("matchTitle");
const matchStatusEl = document.getElementById("matchStatus");
const streamStatus = document.getElementById("streamStatus");

function formatLocalFromUnix(ms) {
  return new Date(ms).toLocaleString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}H ${minutes}M ${seconds}S`;
}

async function fetchJson(path) {
  let lastError;

  for (const base of API_BASES) {
    try {
      const res = await fetch(base + path, {
        headers: { Accept: "application/json" },
        cache: "no-store"
      });
      if (!res.ok) throw new Error(`${base} returned ${res.status}`);
      return await res.json();
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error("All match APIs failed");
}

function readMatchesCache() {
  try {
    const raw = sessionStorage.getItem(MATCHES_CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.data)) return null;
    if (Date.now() - parsed.at > MATCHES_CACHE_TTL) return null;

    return parsed.data;
  } catch (err) {
    return null;
  }
}

function writeMatchesCache(data) {
  try {
    sessionStorage.setItem(
      MATCHES_CACHE_KEY,
      JSON.stringify({ at: Date.now(), data })
    );
  } catch (err) {
    // Storage can be unavailable in private mode; ignore.
  }
}

async function getMatches() {
  const cached = readMatchesCache();
  if (cached) return cached;

  const data = await fetchJson("/api/matches/all");
  if (!Array.isArray(data)) throw new Error("Invalid matches response");

  writeMatchesCache(data);
  return data;
}

function normalizeStreams(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;

  if (Array.isArray(data.streams) && data.streams.length) {
    return data.streams;
  }

  return [
    ...(Array.isArray(data.mainStreams) ? data.mainStreams : []),
    ...(Array.isArray(data.extraStreams) ? data.extraStreams : [])
  ];
}

function streamLabel(stream, index) {
  const quality = stream.quality || (stream.hd ? "HD" : "");
  return [
    stream.displayLabel ||
      stream.sourceName ||
      stream.language ||
      `Channel ${index + 1}`,
    quality
  ]
    .filter(Boolean)
    .join(" ");
}

function setPlayer(stream) {
  playerFrame.referrerPolicy =
    stream.referrerPolicy || "no-referrer-when-downgrade";
  playerFrame.src = stream.embedUrl;
}

const urlParams = new URLSearchParams(window.location.search);
const matchId = urlParams.get("id");

if (!matchId) {
  streamStatus.textContent = "⚠ No match ID provided.";
} else {
  getMatches()
    .then(matches => {
      const match = matches.find(m => m.id === matchId);

      if (!match) {
        streamStatus.textContent = "⚠ Match not found.";
        return;
      }

      matchTitleEl.textContent = match.title || "Match";

      const start = Number(match.date);
      const end = Number(match.ends_at) || start + 150 * 60 * 1000;

      function updateStatus() {
        const now = Date.now();

        if (now >= end) {
          matchStatusEl.innerHTML = `<span class="status-badge status-finished">Finished</span>`;
        } else if (now >= start) {
          matchStatusEl.innerHTML = `<span class="status-badge status-running">Live</span> (Started: ${formatLocalFromUnix(start)})`;
        } else {
          const countdown = formatCountdown(start - now);
          matchStatusEl.innerHTML = `Upcoming — Start: ${formatLocalFromUnix(start)} <br> ⏳ ${countdown}`;
        }
      }

      updateStatus();
      setInterval(updateStatus, 1000);

      const sources = Array.isArray(match.sources) ? match.sources : [];

      if (!sources.length) {
        streamStatus.textContent = "⚠ No streaming sources available.";
        return;
      }

      const streamPromises = sources.map(source =>
        fetchJson(
          `/api/stream/${encodeURIComponent(source.source)}/${encodeURIComponent(source.id)}`
        )
      );

      Promise.allSettled(streamPromises)
        .then(results => {
          const allStreams = [];
          const seen = new Set();

          results.forEach(result => {
            if (result.status !== "fulfilled") return;

            normalizeStreams(result.value).forEach(stream => {
              if (!stream || !stream.embedUrl) return;

              const key = stream.identityKey || stream.embedUrl;
              if (seen.has(key)) return;

              seen.add(key);
              allStreams.push(stream);
            });
          });

          // Fall back to the embed URL already present on each source.
          if (!allStreams.length) {
            sources.forEach(source => {
              if (!source.embedUrl) return;

              allStreams.push({
                embedUrl: source.embedUrl,
                displayLabel: source.name,
                hd: true,
                referrerPolicy: "no-referrer-when-downgrade"
              });
            });
          }

          channelsListEl.innerHTML = "";

          if (!allStreams.length) {
            streamStatus.textContent = "⚠ No streaming channels available.";
            return;
          }

          allStreams.forEach((stream, index) => {
            const btn = document.createElement("button");
            btn.className = "channel-btn";

            const label = streamLabel(stream, index);
            btn.textContent = label;

            btn.addEventListener("click", () => {
              Array.from(channelsListEl.children).forEach(el =>
                el.classList.remove("active")
              );
              btn.classList.add("active");
              setPlayer(stream);
              streamStatus.textContent = `Loaded ${label}`;
            });

            channelsListEl.appendChild(btn);
          });

          const first = allStreams[0];
          const firstLabel = streamLabel(first, 0);
          channelsListEl.firstChild.classList.add("active");
          setPlayer(first);
          streamStatus.textContent = `Loaded ${firstLabel}`;
        })
        .catch(err => {
          console.error(err);
          streamStatus.textContent = "⚠ Error loading streams.";
        });
    })
    .catch(err => {
      console.error(err);
      streamStatus.textContent = "⚠ Error loading match.";
    });
}
