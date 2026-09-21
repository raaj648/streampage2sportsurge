const apiURL = "https://streamed.pk/api/matches/all";

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

const urlParams = new URLSearchParams(window.location.search);
const matchId = urlParams.get("id");

if (!matchId) {
  streamStatus.textContent = "⚠ No match ID provided.";
} else {
  fetch(apiURL)
    .then(res => res.json())
    .then(matches => {
      const match = matches.find(m => m.id === matchId);

      if (!match) {
        streamStatus.textContent = "⚠ Match not found.";
        return;
      }

      matchTitleEl.textContent = match.title || "Match";

      const start = match.date;
      const end = start + 150 * 60 * 1000;

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

      if (match.sources && match.sources.length > 0) {
        const streamPromises = match.sources.map(s =>
          fetch(`https://streamed.pk/api/stream/${s.source}/${s.id}`).then(r => {
            if (!r.ok) throw new Error(`Stream source ${s.source} failed`);
            return r.json();
          })
        );

        Promise.allSettled(streamPromises).then(results => {
          channelsListEl.innerHTML = "";
          let allStreams = [];
          let channelIndex = 0;

          results.forEach(result => {
            if (result.status === "fulfilled" && Array.isArray(result.value)) {
              result.value.forEach(stream => {
                allStreams.push(stream);
                const btn = document.createElement("button");
                btn.className = "channel-btn";
                channelIndex++;
                const label = stream.language ? `${stream.language} ${stream.hd ? "HD" : ""}`.trim() : `Channel ${channelIndex}`;
                btn.textContent = label || `Channel ${channelIndex}`;
                btn.addEventListener("click", () => {
                  Array.from(channelsListEl.children).forEach(el => el.classList.remove("active"));
                  btn.classList.add("active");
                  playerFrame.src = stream.embedUrl;
                  streamStatus.textContent = `Loaded ${label || `channel ${channelIndex}`}`;
                });
                channelsListEl.appendChild(btn);
              });
            }
          });

          if (allStreams.length > 0) {
            const firstBtn = channelsListEl.firstChild;
            firstBtn.classList.add("active");
            playerFrame.src = allStreams[0].embedUrl;
            const firstLabel = allStreams[0].language ? `${allStreams[0].language} ${allStreams[0].hd ? "HD" : ""}`.trim() : "Channel 1";
            streamStatus.textContent = `Loaded ${firstLabel || "channel 1"}`;
          } else {
            streamStatus.textContent = "⚠ No streaming channels available.";
          }
        }).catch(err => {
          console.error(err);
          streamStatus.textContent = "⚠ Error loading streams.";
        });
      } else {
        streamStatus.textContent = "⚠ No streaming sources available.";
      }
    })
    .catch(err => {
      console.error(err);
      streamStatus.textContent = "⚠ Error loading match.";
    });
}
