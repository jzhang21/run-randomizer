(function () {
  const AUTH_URL = "https://accounts.spotify.com/authorize";
  const TOKEN_URL = "https://accounts.spotify.com/api/token";
  const API = "https://api.spotify.com/v1";

  const SCOPES = ["user-top-read", "playlist-modify-private"].join(" ");

  const STORAGE_TOKENS = "run_randomizer_spotify_tokens";
  const STORAGE_PLAYLIST_ID = "run_randomizer_spotify_playlist_id";
  const SESSION_VERIFIER = "run_randomizer_spotify_pkce_verifier";
  const SESSION_STATE = "run_randomizer_spotify_oauth_state";

  const PLAYLIST_NAME = "Run Randomizer";

  function getConfig() {
    return window.SPOTIFY_CONFIG || { clientId: "" };
  }

  /**
   * Spotify rejects "localhost" in redirect URIs (loopback must be a numeric IP).
   * See https://developer.spotify.com/documentation/web-api/concepts/redirect_uri
   */
  function redirectUri() {
    const u = new URL(window.location.href);
    const h = u.hostname;
    if (h === "localhost" || h === "::1" || h === "[::1]") {
      u.hostname = "127.0.0.1";
    }
    u.hash = "";
    u.search = "";
    return `${u.origin}${u.pathname}`;
  }

  function randomString(len, charset) {
    const set =
      charset ||
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    let s = "";
    for (let i = 0; i < len; i++) s += set[arr[i] % set.length];
    return s;
  }

  async function sha256base64url(plain) {
    const data = new TextEncoder().encode(plain);
    const hash = await crypto.subtle.digest("SHA-256", data);
    const bytes = new Uint8Array(hash);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function loadTokens() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_TOKENS) || "null");
    } catch {
      return null;
    }
  }

  function saveTokens(payload) {
    localStorage.setItem(STORAGE_TOKENS, JSON.stringify(payload));
  }

  function clearTokens() {
    localStorage.removeItem(STORAGE_TOKENS);
  }

  async function refreshAccessToken(refreshToken) {
    const clientId = getConfig().clientId;
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    });
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(t || "Token refresh failed");
    }
    const text = await res.text();
    if (!text.trim()) throw new Error("Empty token response from Spotify");
    return JSON.parse(text);
  }

  async function getValidAccessToken() {
    const clientId = getConfig().clientId;
    if (!clientId) return null;

    let data = loadTokens();
    if (!data) return null;

    if (Date.now() < data.expiresAt - 60_000) {
      return data.accessToken;
    }

    if (!data.refreshToken) return null;

    const json = await refreshAccessToken(data.refreshToken);
    const refreshToken = json.refresh_token || data.refreshToken;
    const next = {
      accessToken: json.access_token,
      refreshToken,
      expiresAt: Date.now() + json.expires_in * 1000,
    };
    saveTokens(next);
    return next.accessToken;
  }

  async function exchangeCodeForToken(code, codeVerifier) {
    const clientId = getConfig().clientId;
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
      client_id: clientId,
      code_verifier: codeVerifier,
    });
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(t || "Could not exchange authorization code");
    }
    const text = await res.text();
    if (!text.trim()) throw new Error("Empty token response from Spotify");
    return JSON.parse(text);
  }

  async function api(accessToken, path, options = {}) {
    const hdrs = { Authorization: `Bearer ${accessToken}` };
    if (
      options.body &&
      !(options.headers && options.headers["Content-Type"])
    ) {
      hdrs["Content-Type"] = "application/json";
    }
    Object.assign(hdrs, options.headers);
    const res = await fetch(`${API}${path}`, {
      ...options,
      headers: hdrs,
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(t || res.statusText);
    }
    if (res.status === 204 || res.status === 205) return null;
    const text = await res.text();
    if (!text.trim()) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(
        `Spotify returned non-JSON (${res.status}) for ${path}: ${text.slice(0, 120)}`
      );
    }
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function uniqueTracksById(items) {
    const map = new Map();
    for (const t of items) {
      if (t && t.id && t.uri) map.set(t.id, t);
    }
    return [...map.values()];
  }

  async function fetchTopTracksPool(accessToken) {
    const ranges = ["short_term", "medium_term", "long_term"];
    const results = await Promise.all(
      ranges.map((range) =>
        api(accessToken, `/me/top/tracks?limit=50&time_range=${range}`)
      )
    );
    let merged = uniqueTracksById(results.flatMap((r) => r.items || []));

    if (merged.length < 25) {
      const saved = await api(accessToken, "/me/tracks?limit=50");
      const fromSaved = (saved.items || []).map((x) => x.track).filter(Boolean);
      merged = uniqueTracksById([...merged, ...fromSaved]);
    }

    return merged.filter((t) => t.uri && typeof t.duration_ms === "number");
  }

  function pickTracksForDuration(tracks, targetMs) {
    const picked = [];
    let sum = 0;
    let round = shuffle(tracks);
    let i = 0;
    const maxTracks = 400;
    while (sum < targetMs && picked.length < maxTracks) {
      if (i >= round.length) {
        round = shuffle(tracks);
        i = 0;
      }
      const t = round[i++];
      picked.push(t);
      sum += t.duration_ms;
    }
    if (picked.length === 0 && tracks.length > 0) {
      picked.push(tracks[0]);
      sum = tracks[0].duration_ms;
    }
    return { uris: picked.map((t) => t.uri), totalMs: sum };
  }

  async function findPlaylistByName(accessToken, name) {
    for (let offset = 0; offset < 10_000; offset += 50) {
      const data = await api(
        accessToken,
        `/me/playlists?limit=50&offset=${offset}`
      );
      const items = data.items || [];
      const hit = items.find((p) => p.name === name);
      if (hit) return hit;
      if (!data.next || items.length === 0) break;
    }
    return null;
  }

  async function getOrCreatePlaylist(accessToken, userId) {
    const stored = localStorage.getItem(STORAGE_PLAYLIST_ID);
    if (stored) {
      try {
        const pl = await api(
          accessToken,
          `/playlists/${encodeURIComponent(stored)}`
        );
        if (pl && pl.id) return pl;
      } catch {
        localStorage.removeItem(STORAGE_PLAYLIST_ID);
      }
    }

    const found = await findPlaylistByName(accessToken, PLAYLIST_NAME);
    if (found && found.id) {
      localStorage.setItem(STORAGE_PLAYLIST_ID, found.id);
      return found;
    }

    const created = await api(
      accessToken,
      `/users/${encodeURIComponent(userId)}/playlists`,
      {
        method: "POST",
        body: JSON.stringify({
          name: PLAYLIST_NAME,
          description:
            "Workout playlist from Run Randomizer. Songs are replaced each time you build.",
          public: false,
        }),
      }
    );
    localStorage.setItem(STORAGE_PLAYLIST_ID, created.id);
    return created;
  }

  async function replacePlaylistTracks(accessToken, playlistId, uris) {
    if (uris.length === 0) return;
    const first = uris.slice(0, 100);
    await api(
      accessToken,
      `/playlists/${encodeURIComponent(playlistId)}/tracks`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uris: first }),
      }
    );
    for (let i = 100; i < uris.length; i += 100) {
      const chunk = uris.slice(i, i + 100);
      await api(
        accessToken,
        `/playlists/${encodeURIComponent(playlistId)}/tracks`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uris: chunk }),
        }
      );
    }
  }

  const RunRandomizerSpotify = {
    isConfigured() {
      return Boolean(getConfig().clientId && getConfig().clientId.trim());
    },

    isLoggedIn() {
      return Boolean(loadTokens());
    },

    disconnect() {
      clearTokens();
      localStorage.removeItem(STORAGE_PLAYLIST_ID);
      sessionStorage.removeItem(SESSION_VERIFIER);
      sessionStorage.removeItem(SESSION_STATE);
    },

    async connect() {
      if (!this.isConfigured()) {
        throw new Error("Add your Spotify Client ID in spotify-config.js");
      }
      const verifier = randomString(64);
      const challenge = await sha256base64url(verifier);
      const state = randomString(16);
      sessionStorage.setItem(SESSION_VERIFIER, verifier);
      sessionStorage.setItem(SESSION_STATE, state);

      const u = new URL(AUTH_URL);
      u.searchParams.set("client_id", getConfig().clientId.trim());
      u.searchParams.set("response_type", "code");
      u.searchParams.set("redirect_uri", redirectUri());
      u.searchParams.set("scope", SCOPES);
      u.searchParams.set("code_challenge_method", "S256");
      u.searchParams.set("code_challenge", challenge);
      u.searchParams.set("state", state);

      window.location.assign(u.toString());
    },

    async finishAuthIfNeeded() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const state = params.get("state");
      const err = params.get("error");

      if (err) {
        const desc = params.get("error_description") || err;
        const clean = window.location.pathname + window.location.hash;
        window.history.replaceState(null, "", clean);
        throw new Error(desc);
      }

      if (!code) return;

      const expectedState = sessionStorage.getItem(SESSION_STATE);
      const verifier = sessionStorage.getItem(SESSION_VERIFIER);
      if (!state || !expectedState || state !== expectedState || !verifier) {
        window.history.replaceState(null, "", window.location.pathname + window.location.hash);
        throw new Error("Spotify login state mismatch. Try Connect again.");
      }

      const json = await exchangeCodeForToken(code, verifier);
      sessionStorage.removeItem(SESSION_VERIFIER);
      sessionStorage.removeItem(SESSION_STATE);

      saveTokens({
        accessToken: json.access_token,
        refreshToken: json.refresh_token,
        expiresAt: Date.now() + json.expires_in * 1000,
      });

      const clean = window.location.pathname + window.location.hash;
      window.history.replaceState(null, "", clean);
    },

    async getProfileLabel() {
      const token = await getValidAccessToken();
      if (!token) return null;
      const me = await api(token, "/me");
      return me.display_name || me.email || me.id || "Spotify";
    },

    async createPlaylistForRun(miles, paceMinutesPerMile) {
      const token = await getValidAccessToken();
      if (!token) throw new Error("Connect Spotify first");

      const pace = paceMinutesPerMile;
      const targetMs = miles * pace * 60 * 1000;

      const me = await api(token, "/me");
      const userId = me.id;
      if (!userId) throw new Error("Could not read Spotify profile");

      const pool = await fetchTopTracksPool(token);
      if (pool.length === 0) {
        throw new Error(
          "No tracks found. Listen on Spotify for a bit so we can read your taste, or save some songs."
        );
      }

      const { uris, totalMs } = pickTracksForDuration(pool, targetMs);
      const targetMin = Math.round((targetMs / 60000) * 10) / 10;
      const actualMin = Math.round((totalMs / 60000) * 10) / 10;

      const playlist = await getOrCreatePlaylist(token, userId);
      const id = playlist.id;

      const desc = `Last build: ${Math.round(miles * 10) / 10} mi, ~${pace} min/mi · ~${actualMin} min of music · ${new Date().toLocaleString()}`;
      await api(token, `/playlists/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify({
          description: desc.slice(0, 300),
        }),
      });

      await replacePlaylistTracks(token, id, uris);

      return {
        url: playlist.external_urls && playlist.external_urls.spotify,
        name: playlist.name,
        trackCount: uris.length,
        approxMinutes: actualMin,
        targetMinutes: targetMin,
      };
    },
  };

  window.RunRandomizerSpotify = RunRandomizerSpotify;
})();
