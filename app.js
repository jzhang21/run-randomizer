document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("run-form");
  const distMinEl = document.getElementById("dist-min");
  const distMaxEl = document.getElementById("dist-max");
  const paceMinEl = document.getElementById("pace-min");
  const paceMaxEl = document.getElementById("pace-max");
  const formError = document.getElementById("form-error");
  const submitBtn = document.getElementById("submit-btn");
  const rollStage = document.getElementById("roll-stage");
  const rollTitle = rollStage.querySelector(".roll-header h2");
  const diceRow = document.getElementById("dice-row");
  const rollResults = document.getElementById("roll-results");
  const resultDistance = document.getElementById("result-distance");
  const resultPace = document.getElementById("result-pace");
  const paceResultBlock = document.getElementById("pace-result-block");
  const againBtn = document.getElementById("again-btn");

  const spotifyBarStatus = document.getElementById("spotify-bar-status");
  const spotifyConnectBtn = document.getElementById("spotify-connect-btn");
  const spotifyDisconnectBtn = document.getElementById("spotify-disconnect-btn");
  const spotifyPlaylistPanel = document.getElementById("spotify-playlist-panel");
  const spotifyTargetLine = document.getElementById("spotify-target-line");
  const spotifyBuildPlaylistBtn = document.getElementById("spotify-build-playlist-btn");
  const spotifyBuildPlaylistLabel = spotifyBuildPlaylistBtn.querySelector(
    ".spotify-playlist-cta-text"
  );
  const spotifyPlaylistMsg = document.getElementById("spotify-playlist-msg");

  const SPOTIFY_CTA_CREATE = "Create Playlist";
  const SPOTIFY_CTA_OPEN = "Open Playlist";

  const DEFAULT_PACE_FOR_PLAYLIST = 10;

  let lastRoll = null;
  /** When set, primary button opens this URL instead of rebuilding. */
  let spotifyPlaylistOpenUrl = null;
  let rolling = false;

  function pipMarkup(n) {
    const pips = Array.from({ length: n }, () => '<span class="pip"></span>').join("");
    return `<div class="pips" data-value="${n}">${pips}</div>`;
  }

  function faceInner(value) {
    if (value >= 1 && value <= 6) {
      return pipMarkup(value);
    }
    return `<span>${value}</span>`;
  }

  function createCubeHTML() {
    const faces = [
      { cls: "front", val: 1 },
      { cls: "back", val: 6 },
      { cls: "right", val: 3 },
      { cls: "left", val: 4 },
      { cls: "top", val: 5 },
      { cls: "bottom", val: 2 },
    ];
    return faces.map((f) => `<div class="face ${f.cls}">${faceInner(f.val)}</div>`).join("");
  }

  function buildDie(labelText) {
    const wrap = document.createElement("div");
    wrap.className = "die-wrap";
    wrap.innerHTML = `
      <span class="die-label">${labelText}</span>
      <div class="scene">
        <div class="cube rolling">${createCubeHTML()}</div>
      </div>
    `;
    return wrap;
  }

  function rotationForFace(faceIndex) {
    const map = [
      `rotateY(0deg)`,
      `rotateX(-90deg)`,
      `rotateY(-90deg)`,
      `rotateY(90deg)`,
      `rotateX(90deg)`,
      `rotateY(180deg)`,
    ];
    return map[faceIndex];
  }

  function randomFaceIndex() {
    return Math.floor(Math.random() * 6);
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function animateCubeRoll(cube, durationMs, onDone) {
    const start = performance.now();
    const extraSpins = 3 + Math.floor(Math.random() * 3);
    const targetFace = randomFaceIndex();
    const endRot = rotationForFace(targetFace);

    function frame(now) {
      const t = Math.min(1, (now - start) / durationMs);
      const e = easeOutCubic(t);
      const spinX = extraSpins * 360 * (1 - e) + (Math.random() * 40 - 20) * (1 - e);
      const spinY = extraSpins * 360 * (1 - e) + (Math.random() * 40 - 20) * (1 - e);
      const spinZ = (extraSpins * 0.5 * 360 * (1 - e)) | 0;

      if (t < 1) {
        cube.style.transition = "none";
        cube.style.transform = `rotateX(${spinX}deg) rotateY(${spinY}deg) rotateZ(${spinZ}deg)`;
        requestAnimationFrame(frame);
      } else {
        cube.classList.remove("rolling");
        cube.style.transition = "transform 0.65s cubic-bezier(0.22, 1, 0.36, 1)";
        cube.style.transform = endRot;
        setTimeout(() => {
          if (onDone) onDone();
        }, 680);
      }
    }
    requestAnimationFrame(frame);
  }

  function randomInRange(min, max) {
    return min + Math.random() * (max - min);
  }

  const PACE_STEP_MIN = 0.25;
  const PACE_QUARTERS_PER_MIN = 4;

  function isOnPaceGrid(minutes) {
    const q = Math.round(minutes * PACE_QUARTERS_PER_MIN) / PACE_QUARTERS_PER_MIN;
    return Math.abs(minutes - q) < 1e-6;
  }

  function randomPaceOnGrid(min, max) {
    const low = Math.round(min * PACE_QUARTERS_PER_MIN);
    const high = Math.round(max * PACE_QUARTERS_PER_MIN);
    const pick = low + Math.floor(Math.random() * (high - low + 1));
    return pick / PACE_QUARTERS_PER_MIN;
  }

  function formatMiles(n) {
    const rounded = Math.round(n * 10) / 10;
    return `${rounded} mi`;
  }

  function formatPaceMinutesPerMile(minutesDecimal) {
    const quarters = Math.round(minutesDecimal * PACE_QUARTERS_PER_MIN);
    const totalSec = quarters * 15;
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${String(s).padStart(2, "0")} / mi`;
  }

  function parseOptionalPace() {
    const a = paceMinEl.value.trim();
    const b = paceMaxEl.value.trim();
    if (!a && !b) return { ok: true, includePace: false };
    if (!a || !b) {
      return {
        ok: false,
        message: "For pace, enter both min and max, or leave both blank.",
      };
    }
    const min = parseFloat(a);
    const max = parseFloat(b);
    if (Number.isNaN(min) || Number.isNaN(max)) {
      return { ok: false, message: "Pace values must be numbers." };
    }
    if (min < 0 || max < 0) {
      return { ok: false, message: "Pace cannot be negative." };
    }
    if (min > max) {
      return { ok: false, message: "Pace min must be ≤ max." };
    }
    if (!isOnPaceGrid(min) || !isOnPaceGrid(max)) {
      return {
        ok: false,
        message:
          "Pace must be in 0.25 min/mi steps (15 seconds per mile), e.g. 8 or 8.25.",
      };
    }
    return { ok: true, includePace: true, min, max };
  }

  function distanceAtMostOneDecimal(raw) {
    const t = raw.trim();
    if (!t) return false;
    const parts = t.split(".");
    if (parts.length === 1) return true;
    if (parts.length > 2) return false;
    return (parts[1] || "").length <= 1;
  }

  function validateDistance() {
    const minStr = distMinEl.value;
    const maxStr = distMaxEl.value;
    if (!minStr.trim() || !maxStr.trim()) {
      return { ok: false, message: "Enter both min and max distance." };
    }
    if (!distanceAtMostOneDecimal(minStr) || !distanceAtMostOneDecimal(maxStr)) {
      return {
        ok: false,
        message: "Distance can use at most one decimal place (e.g. 9.2, not 9.02).",
      };
    }
    const min = parseFloat(minStr);
    const max = parseFloat(maxStr);
    if (Number.isNaN(min) || Number.isNaN(max)) {
      return { ok: false, message: "Enter both min and max distance." };
    }
    if (min < 0 || max < 0) {
      return { ok: false, message: "Distance cannot be negative." };
    }
    if (min > max) {
      return { ok: false, message: "Distance min must be ≤ max." };
    }
    return { ok: true, min, max };
  }

  function showFormError(msg) {
    formError.textContent = msg;
    formError.hidden = false;
  }

  function clearFormError() {
    formError.hidden = true;
    formError.textContent = "";
  }

  function refreshBuildPlaylistButton() {
    const base =
      window.RunRandomizerSpotify &&
      RunRandomizerSpotify.isConfigured() &&
      RunRandomizerSpotify.isLoggedIn() &&
      lastRoll &&
      !rolling;
    const canOpen = base && spotifyPlaylistOpenUrl;
    const canCreate = base && !spotifyPlaylistOpenUrl;
    spotifyBuildPlaylistBtn.disabled = !(canOpen || canCreate);
  }

  function setSpotifyPlaylistCtaCreate() {
    spotifyPlaylistOpenUrl = null;
    spotifyBuildPlaylistLabel.textContent = SPOTIFY_CTA_CREATE;
  }

  function syncSpotifyBar() {
    if (!window.RunRandomizerSpotify) return;
    spotifyBarStatus.classList.remove("is-error");
    if (!RunRandomizerSpotify.isConfigured()) {
      spotifyConnectBtn.disabled = true;
      spotifyConnectBtn.hidden = false;
      spotifyDisconnectBtn.hidden = true;
      spotifyBarStatus.textContent =
        "Add your Spotify Client ID in spotify-config.js to enable linking.";
      refreshBuildPlaylistButton();
      return;
    }
    spotifyConnectBtn.disabled = false;
    if (RunRandomizerSpotify.isLoggedIn()) {
      spotifyConnectBtn.hidden = true;
      spotifyDisconnectBtn.hidden = false;
      spotifyBarStatus.textContent = "Connected.";
      RunRandomizerSpotify.getProfileLabel().then((name) => {
        if (name) spotifyBarStatus.textContent = `Connected as ${name}.`;
      });
    } else {
      spotifyConnectBtn.hidden = false;
      spotifyDisconnectBtn.hidden = true;
      spotifyBarStatus.textContent = "Not connected.";
    }
    refreshBuildPlaylistButton();
  }

  function resetSpotifyPlaylistUi() {
    spotifyPlaylistMsg.textContent = "";
    spotifyPlaylistMsg.classList.remove("is-error");
    setSpotifyPlaylistCtaCreate();
  }

  function showPlaylistPanelAfterRoll(distRoll, includePace, paceRoll) {
    const paceMin =
      includePace && paceRoll != null ? paceRoll : DEFAULT_PACE_FOR_PLAYLIST;
    lastRoll = { miles: distRoll, paceMinutesPerMile: paceMin };
    const targetMin = Math.round(distRoll * paceMin);
    const paceBit =
      includePace && paceRoll != null
        ? formatPaceMinutesPerMile(paceRoll).replace(" / mi", "/mi")
        : `${DEFAULT_PACE_FOR_PLAYLIST}:00/mi`;
    spotifyTargetLine.textContent = `About ${targetMin} min of music (${formatMiles(distRoll)} at ${paceBit}).`;
    spotifyPlaylistPanel.hidden = false;
    resetSpotifyPlaylistUi();
    refreshBuildPlaylistButton();
  }

  function runRoll(includePace, distRange, paceRange) {
    rolling = true;
    submitBtn.disabled = true;
    rollTitle.textContent = "Rolling…";
    diceRow.innerHTML = "";
    rollResults.hidden = true;
    paceResultBlock.hidden = true;
    rollStage.hidden = false;
    rollStage.scrollIntoView({ behavior: "smooth", block: "center" });
    spotifyPlaylistPanel.hidden = true;
    resetSpotifyPlaylistUi();
    lastRoll = null;
    refreshBuildPlaylistButton();

    const d1 = buildDie("Distance");
    diceRow.appendChild(d1);
    const cubes = [d1.querySelector(".cube")];

    if (includePace) {
      const d2 = buildDie("Pace");
      diceRow.appendChild(d2);
      cubes.push(d2.querySelector(".cube"));
    }

    const distRoll = randomInRange(distRange.min, distRange.max);
    const paceRoll = includePace ? randomPaceOnGrid(paceRange.min, paceRange.max) : null;

    const duration = 2200 + Math.random() * 400;

    let finished = 0;
    function checkAllDone() {
      finished += 1;
      if (finished < cubes.length) return;
      rollTitle.textContent = "Your Run";
      resultDistance.textContent = formatMiles(distRoll);
      if (includePace && paceRoll != null) {
        paceResultBlock.hidden = false;
        resultPace.textContent = formatPaceMinutesPerMile(paceRoll);
      }
      rollResults.hidden = false;
      rolling = false;
      submitBtn.disabled = false;
      showPlaylistPanelAfterRoll(distRoll, includePace, paceRoll);
      requestAnimationFrame(() => {
        rollStage.querySelector(".roll-header")?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      });
    }

    cubes.forEach((cube, i) => {
      const delay = i * 120;
      setTimeout(() => {
        animateCubeRoll(cube, duration + delay * 0.3, checkAllDone);
      }, delay);
    });
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    clearFormError();

    const dist = validateDistance();
    if (!dist.ok) {
      showFormError(dist.message);
      return;
    }

    const pace = parseOptionalPace();
    if (!pace.ok) {
      showFormError(pace.message);
      return;
    }

    runRoll(pace.includePace, dist, pace.includePace ? pace : null);
  });

  againBtn.addEventListener("click", () => {
    if (rolling) return;
    clearFormError();
    const dist = validateDistance();
    const pace = parseOptionalPace();
    if (!dist.ok || !pace.ok) return;
    runRoll(pace.includePace, dist, pace.includePace ? pace : null);
  });

  spotifyConnectBtn.addEventListener("click", () => {
    spotifyBarStatus.classList.remove("is-error");
    try {
      RunRandomizerSpotify.connect();
    } catch (err) {
      spotifyBarStatus.textContent = err.message || "Could not start Spotify login.";
      spotifyBarStatus.classList.add("is-error");
    }
  });

  spotifyDisconnectBtn.addEventListener("click", () => {
    RunRandomizerSpotify.disconnect();
    syncSpotifyBar();
    resetSpotifyPlaylistUi();
    spotifyPlaylistPanel.hidden = true;
    lastRoll = null;
  });

  spotifyBuildPlaylistBtn.addEventListener("click", async () => {
    if (spotifyPlaylistOpenUrl) {
      window.open(spotifyPlaylistOpenUrl, "_blank", "noopener,noreferrer");
      return;
    }
    if (!lastRoll) return;
    spotifyBuildPlaylistBtn.disabled = true;
    spotifyPlaylistMsg.classList.remove("is-error");
    spotifyPlaylistMsg.textContent = "Updating Run Randomizer playlist…";
    try {
      const r = await RunRandomizerSpotify.createPlaylistForRun(
        lastRoll.miles,
        lastRoll.paceMinutesPerMile
      );
      spotifyPlaylistMsg.textContent = `${r.trackCount} tracks, about ${r.approxMinutes} min.`;
      if (r.url) {
        spotifyPlaylistOpenUrl = r.url;
        spotifyBuildPlaylistLabel.textContent = SPOTIFY_CTA_OPEN;
      }
    } catch (err) {
      let msg = err.message || "Could not create playlist.";
      try {
        const j = JSON.parse(msg);
        if (j.error_description) msg = j.error_description;
        else if (typeof j.error === "string") msg = j.error;
        else if (j.error && j.error.message) msg = j.error.message;
      } catch {
        /* use raw */
      }
      spotifyPlaylistMsg.textContent = msg;
      spotifyPlaylistMsg.classList.add("is-error");
      setSpotifyPlaylistCtaCreate();
    } finally {
      refreshBuildPlaylistButton();
    }
  });

  (async () => {
    try {
      await RunRandomizerSpotify.finishAuthIfNeeded();
    } catch (err) {
      spotifyBarStatus.textContent = err.message || "Spotify login failed.";
      spotifyBarStatus.classList.add("is-error");
    }
    syncSpotifyBar();
  })();
});
