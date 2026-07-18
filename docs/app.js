// Trage hier deinen eigenen Mapbox Public Access Token ein (siehe README.md).
const MAPBOX_TOKEN = "pk.eyJ1IjoiZG9taW5pay1ob2xsbWFubjEyMyIsImEiOiJjbXJxaXpycWEwMWNqMnlwbXJqdmY1MDhpIn0.GvYBbWqbDDTxpFCpZvlOpQ";

// Muss exakt der Sequenz aus scrape_thetopo.py (FONT_SEQUENCE) entsprechen.
// "ungraded"-Boulder sind bewusst nicht Teil dieser Sequenz -- sie werden vom
// Gradfilter nie mitgezählt (siehe Plan: "Grad-Filter-Semantik").
const FONT_SEQUENCE = [
  "3", "3+", "4", "4+", "5", "5+",
  "6A", "6A+", "6B", "6B+", "6C", "6C+",
  "7A", "7A+", "7B", "7B+", "7C", "7C+",
  "8A", "8A+", "8B", "8B+", "8C", "8C+",
  "9A", "9A+", "9B", "9B+", "9C",
];

// Standard Mapbox gallery styles (https://www.mapbox.com/gallery), offered
// via a custom control next to the zoom buttons since dark-v11 alone is
// pretty but low-contrast for some regions/zooms.
const MAP_STYLES = [
  { id: "dark-v11", label: "Dark" },
  { id: "light-v11", label: "Light" },
  { id: "streets-v12", label: "Streets" },
  { id: "outdoors-v12", label: "Outdoors" },
  { id: "satellite-streets-v12", label: "Satellite" },
];
const DEFAULT_STYLE_ID = "dark-v11";
const STYLE_STORAGE_KEY = "mapStyleId";
const GRADE_RANGE_STORAGE_KEY = "gradeRange";

// Standard "share" glyph (three connected nodes), reused for the per-crag
// and the current-view share buttons.
const SHARE_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">' +
  '<path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z"/>' +
  "</svg>";

// Release notes shown in a "what's new" popup. Each entry needs a unique,
// increasing `version` -- append a new entry (higher version) whenever
// there's something worth telling returning users about. Keep `changes`
// aggregated/user-facing (no commit-level or purely cosmetic detail).
const RELEASE_NOTES = [
  {
    version: 1,
    date: "2026-07-18",
    changes: [
      "Weltweite Daten: jetzt alle Kontinente (691 Regionen, 71 Länder) statt nur Europa.",
      "Listenansicht: Klick auf eine Kachel springt zur Karte und zoomt aufs Gebiet; Klick auf den Namen öffnet weiterhin die thetopo.com-Seite.",
      "Teilen-Funktion: einzelne Gebiete und die aktuelle Kartenansicht (inkl. Grad-Filter) lassen sich per Link teilen, z.B. über WhatsApp.",
    ],
  },
];
const RELEASE_SEEN_STORAGE_KEY = "seenReleaseVersion";

function showReleaseNotesIfNeeded() {
  let seenVersion = 0;
  try {
    seenVersion = parseInt(localStorage.getItem(RELEASE_SEEN_STORAGE_KEY), 10) || 0;
  } catch (err) {
    // localStorage unavailable -- just show notes every time in that rare case.
  }

  const unseen = RELEASE_NOTES.filter((r) => r.version > seenVersion).sort((a, b) => a.version - b.version);
  if (unseen.length === 0) return;

  const body = document.getElementById("release-modal-body");
  body.innerHTML = "";
  for (const release of unseen) {
    const entry = document.createElement("div");
    entry.className = "release-entry";
    const dateEl = document.createElement("div");
    dateEl.className = "release-entry-date";
    dateEl.textContent = release.date;
    const list = document.createElement("ul");
    for (const change of release.changes) {
      const li = document.createElement("li");
      li.textContent = change;
      list.appendChild(li);
    }
    entry.appendChild(dateEl);
    entry.appendChild(list);
    body.appendChild(entry);
  }

  const modal = document.getElementById("release-modal");
  modal.classList.remove("hidden");

  const latestVersion = unseen[unseen.length - 1].version;
  const markSeen = () => {
    modal.classList.add("hidden");
    try {
      localStorage.setItem(RELEASE_SEEN_STORAGE_KEY, String(latestVersion));
    } catch (err) {
      // ignore -- worst case the popup shows again next time
    }
  };
  document.getElementById("release-modal-close").addEventListener("click", markSeen, { once: true });
  modal.addEventListener("click", (e) => {
    if (e.target === modal) markSeen();
  }, { once: true });
}

// localStorage can throw in locked-down/private-browsing contexts -- treat
// persistence as a nice-to-have and fall back to defaults if unavailable.
function loadLocalStorageJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function saveLocalStorageJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    // ignore
  }
}

function showError(message) {
  const el = document.getElementById("loading-error");
  el.textContent = message;
  el.classList.remove("hidden");
}

function gradeIndex(label) {
  return FONT_SEQUENCE.indexOf(label);
}

async function loadCrags() {
  const res = await fetch("data/crags.json");
  if (!res.ok) {
    throw new Error(`crags.json konnte nicht geladen werden (HTTP ${res.status})`);
  }
  return res.json();
}

function computeObservedRange(crags) {
  let min = FONT_SEQUENCE.length - 1;
  let max = 0;
  for (const crag of crags) {
    for (const label of Object.keys(crag.grades)) {
      const idx = gradeIndex(label);
      if (idx < 0) continue; // "ungraded" or unknown -- not part of the filterable range
      if (idx < min) min = idx;
      if (idx > max) max = idx;
    }
  }
  if (min > max) {
    min = 0;
    max = FONT_SEQUENCE.length - 1;
  }
  return [min, max];
}

function countInRange(crag, minIdx, maxIdx) {
  let count = 0;
  for (const [label, n] of Object.entries(crag.grades)) {
    const idx = gradeIndex(label);
    if (idx < 0) continue;
    if (idx >= minIdx && idx <= maxIdx) count += n;
  }
  return count;
}

function buildGeoJSON(crags, minIdx, maxIdx) {
  const features = [];
  let totalBoulders = 0;

  for (const crag of crags) {
    if (crag.lat == null || crag.lng == null) continue;

    const count = countInRange(crag, minIdx, maxIdx);
    if (count <= 0) continue;

    totalBoulders += count;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [crag.lng, crag.lat] },
      properties: {
        name: crag.name,
        url: crag.url,
        region: crag.region,
        country: crag.country,
        count,
      },
    });
  }

  return {
    geojson: { type: "FeatureCollection", features },
    matchingCragCount: features.length,
    totalBoulders,
  };
}

// Same idea as buildGeoJSON's totals, but restricted to crags within
// `bounds` -- used for the stats line so it reflects the current map
// viewport instead of all of Europe. `bounds` null (no map) means "all".
function computeBoundedStats(crags, minIdx, maxIdx, bounds) {
  let matchingCragCount = 0;
  let totalBoulders = 0;
  for (const crag of crags) {
    if (crag.lat == null || crag.lng == null) continue;
    if (bounds && !bounds.contains([crag.lng, crag.lat])) continue;
    const count = countInRange(crag, minIdx, maxIdx);
    if (count <= 0) continue;
    matchingCragCount++;
    totalBoulders += count;
  }
  return { matchingCragCount, totalBoulders };
}

const LIST_MAX_ITEMS = 300;

// The thetopo.com crag slug (last URL path segment) doubles as a stable ID
// for our own deep-links (#crag=<slug>), e.g. for the share button.
function cragSlug(url) {
  const parts = url.split("/").filter(Boolean);
  return parts[parts.length - 1];
}

function buildShareUrl(slug) {
  return `${location.origin}${location.pathname}#crag=${encodeURIComponent(slug)}`;
}

// Shares the current map viewport (center/zoom) + grade filter, but
// deliberately NOT the map style -- that's a personal display preference,
// not something worth pinning for whoever opens the link.
function buildViewShareUrl(lng, lat, zoom, minIdx, maxIdx) {
  const view = `${lng.toFixed(4)},${lat.toFixed(4)},${zoom.toFixed(2)}`;
  return `${location.origin}${location.pathname}#view=${view}&grade=${minIdx}-${maxIdx}`;
}

function findCragBySlug(crags, slug) {
  return crags.find((c) => cragSlug(c.url) === slug);
}

function parseHashParams() {
  return new URLSearchParams(location.hash.replace(/^#/, ""));
}

// Returns [minIdx, maxIdx] from a "minIdx-maxIdx" hash param if present and
// within [observedMin, observedMax], else null.
function parseGradeHashParam(hashParams, observedMin, observedMax) {
  const raw = hashParams.get("grade");
  if (!raw) return null;
  const match = /^(\d+)-(\d+)$/.exec(raw);
  if (!match) return null;
  const minIdx = parseInt(match[1], 10);
  const maxIdx = parseInt(match[2], 10);
  if (minIdx > maxIdx || minIdx < observedMin || maxIdx > observedMax) return null;
  return [minIdx, maxIdx];
}

// Returns {center: [lng, lat], zoom} from a "lng,lat,zoom" hash param, else null.
function parseViewHashParam(hashParams) {
  const raw = hashParams.get("view");
  if (!raw) return null;
  const parts = raw.split(",").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  const [lng, lat, zoom] = parts;
  return { center: [lng, lat], zoom };
}

// `bounds` is a mapboxgl.LngLatBounds, or null when there's no map (no
// token) -- in that case every crag counts as "visible".
function computeListItems(crags, minIdx, maxIdx, bounds) {
  const items = [];
  for (const crag of crags) {
    if (crag.lat == null || crag.lng == null) continue;
    if (bounds && !bounds.contains([crag.lng, crag.lat])) continue;

    const count = countInRange(crag, minIdx, maxIdx);
    if (count <= 0) continue;

    items.push({
      name: crag.name,
      region: crag.region,
      country: crag.country,
      url: crag.url,
      lat: crag.lat,
      lng: crag.lng,
      slug: cragSlug(crag.url),
      count,
    });
  }
  items.sort((a, b) => b.count - a.count);
  return items;
}

async function shareLink(shareData) {
  if (navigator.share) {
    try {
      await navigator.share(shareData);
    } catch (err) {
      // user cancelled the share sheet -- not an error
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(shareData.url);
    alert("Link kopiert:\n" + shareData.url);
  } catch (err) {
    prompt("Link zum Teilen:", shareData.url);
  }
}

function shareCrag(item) {
  return shareLink({
    title: item.name,
    text: `${item.name} (${item.region}, ${item.country}) auf The Topo Bouldergebietsuche`,
    url: buildShareUrl(item.slug),
  });
}

// `onSelectCrag(item)` is called when a card is clicked anywhere except the
// name link or the share button -- switches to the map view, zoomed in.
function renderList(items, onSelectCrag) {
  const container = document.getElementById("list-items");
  container.innerHTML = "";

  const shown = items.slice(0, LIST_MAX_ITEMS);
  for (const item of shown) {
    const card = document.createElement("div");
    card.className = "list-item";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.innerHTML =
      `<div class="list-item-main">` +
      `<a class="list-item-name" href="${item.url}" target="_blank" rel="noopener"></a>` +
      `<div class="list-item-location"></div>` +
      `</div>` +
      `<button type="button" class="list-item-share" aria-label="Gebiet teilen">${SHARE_ICON_SVG}</button>` +
      `<div class="list-item-count"></div>`;
    card.querySelector(".list-item-name").textContent = item.name;
    card.querySelector(".list-item-location").textContent = `${item.region}, ${item.country}`;
    card.querySelector(".list-item-count").textContent = item.count.toLocaleString("de-DE");

    card.querySelector(".list-item-name").addEventListener("click", (e) => e.stopPropagation());
    card.querySelector(".list-item-share").addEventListener("click", (e) => {
      e.stopPropagation();
      shareCrag(item);
    });
    card.addEventListener("click", () => onSelectCrag(item));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelectCrag(item);
      }
    });

    container.appendChild(card);
  }

  if (items.length === 0) {
    const note = document.createElement("div");
    note.className = "list-note";
    note.textContent = "Keine Gebiete im aktuellen Kartenausschnitt/Grad-Filter.";
    container.appendChild(note);
  } else if (items.length > LIST_MAX_ITEMS) {
    const note = document.createElement("div");
    note.className = "list-note";
    note.textContent =
      `+${(items.length - LIST_MAX_ITEMS).toLocaleString("de-DE")} weitere Gebiete im sichtbaren Bereich -- weiter reinzoomen, um alle zu sehen.`;
    container.appendChild(note);
  }
}

// Custom Mapbox GL control (dropdown button) for picking one of MAP_STYLES,
// placed next to the zoom/fullscreen controls via map.addControl(..., "top-right").
class StyleSwitcherControl {
  constructor(activeStyleId, onSelect) {
    this._activeStyleId = activeStyleId;
    this._onSelect = onSelect;
  }

  onAdd() {
    const container = document.createElement("div");
    container.className = "mapboxgl-ctrl style-switcher";

    const button = document.createElement("button");
    button.type = "button";
    button.title = "Kartenstil wählen";
    button.className = "style-switcher-button";
    button.textContent = "▤"; // simple layers-like glyph, no external icon needed

    const menu = document.createElement("div");
    menu.className = "style-switcher-menu hidden";
    for (const style of MAP_STYLES) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "style-switcher-item" + (style.id === this._activeStyleId ? " active" : "");
      item.textContent = style.label;
      item.addEventListener("click", () => {
        for (const el of menu.querySelectorAll(".style-switcher-item")) el.classList.remove("active");
        item.classList.add("active");
        menu.classList.add("hidden");
        this._onSelect(style.id);
      });
      menu.appendChild(item);
    }

    button.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.classList.toggle("hidden");
    });
    document.addEventListener("click", () => menu.classList.add("hidden"));

    container.appendChild(button);
    container.appendChild(menu);
    this._container = container;
    return container;
  }

  onRemove() {
    this._container.parentNode.removeChild(this._container);
  }
}

async function main() {
  // Panel toggle (mobile bottom sheet) works regardless of map/token status.
  const panel = document.getElementById("panel");
  document.getElementById("panel-toggle").addEventListener("click", () => {
    panel.classList.toggle("collapsed");
  });

  showReleaseNotesIfNeeded();

  let crags;
  try {
    crags = await loadCrags();
  } catch (err) {
    showError("Boulder-Daten konnten nicht geladen werden: " + err.message);
    return;
  }

  const [observedMin, observedMax] = computeObservedRange(crags);
  const statsEl = document.getElementById("stats");
  const hashParams = parseHashParams();

  // Grade filter precedence: an explicit shared #grade=... link wins, then a
  // previously saved filter (if still within the observed range), else full range.
  const savedRange = loadLocalStorageJSON(GRADE_RANGE_STORAGE_KEY);
  const hashRange = parseGradeHashParam(hashParams, observedMin, observedMax);
  const [startMin, startMax] =
    hashRange ||
    (Array.isArray(savedRange) && savedRange.length === 2 &&
      savedRange[0] >= observedMin && savedRange[1] <= observedMax && savedRange[0] <= savedRange[1]
      ? savedRange
      : [observedMin, observedMax]);

  // --- Slider setup (independent of Mapbox so it still works if the map fails) ---
  const slider = document.getElementById("grade-slider");
  const minLabelEl = document.getElementById("grade-min-label");
  const maxLabelEl = document.getElementById("grade-max-label");

  noUiSlider.create(slider, {
    start: [startMin, startMax],
    connect: true,
    step: 1,
    range: { min: observedMin, max: observedMax },
    tooltips: false,
  });

  function setRangeLabels(minIdx, maxIdx) {
    minLabelEl.textContent = FONT_SEQUENCE[minIdx];
    maxLabelEl.textContent = FONT_SEQUENCE[maxIdx];
  }
  setRangeLabels(startMin, startMax);

  function updateStats(matchingCragCount, totalBoulders) {
    statsEl.textContent =
      `${matchingCragCount.toLocaleString("de-DE")} von ${crags.length.toLocaleString("de-DE")} Gebieten -- ` +
      `${totalBoulders.toLocaleString("de-DE")} Boulder im gewählten Bereich`;
  }

  // `map` is assigned below only if a Mapbox token is present; refreshData
  // guards against it being null so the slider/stats stay usable either way.
  let map = null;
  let currentView = "map";
  let currentMinIdx = startMin;
  let currentMaxIdx = startMax;

  const listView = document.getElementById("list-view");

  function setView(viewName) {
    currentView = viewName;
    for (const b of document.querySelectorAll(".view-toggle-btn")) {
      b.classList.toggle("active", b.dataset.view === viewName);
    }
    listView.classList.toggle("hidden", viewName !== "list");
    if (viewName === "list") refreshList();
  }

  // Clicking a list card (anywhere except the name link / share button)
  // switches to the map, zoomed in on that crag.
  function goToCragOnMap(item) {
    if (!map) {
      window.open(item.url, "_blank", "noopener");
      return;
    }
    setView("map");
    map.flyTo({ center: [item.lng, item.lat], zoom: 14 });
  }

  function refreshList() {
    if (currentView !== "list") return;
    const bounds = map ? map.getBounds() : null;
    renderList(computeListItems(crags, currentMinIdx, currentMaxIdx, bounds), goToCragOnMap);
  }

  // Stats reflect the current map viewport (like the list), not all of
  // Europe -- so panning/zooming updates the numbers, not just the slider.
  function refreshStats() {
    const bounds = map ? map.getBounds() : null;
    const { matchingCragCount, totalBoulders } = computeBoundedStats(crags, currentMinIdx, currentMaxIdx, bounds);
    updateStats(matchingCragCount, totalBoulders);
  }

  function refreshData(minIdx, maxIdx) {
    currentMinIdx = minIdx;
    currentMaxIdx = maxIdx;
    const { geojson } = buildGeoJSON(crags, minIdx, maxIdx);
    if (map) {
      const source = map.getSource("crags");
      if (source) source.setData(geojson);
    }
    refreshStats();
    refreshList();
  }

  slider.noUiSlider.on("update", (values) => {
    const minIdx = Math.round(values[0]);
    const maxIdx = Math.round(values[1]);
    setRangeLabels(minIdx, maxIdx);
    saveLocalStorageJSON(GRADE_RANGE_STORAGE_KEY, [minIdx, maxIdx]);
    if (!map || map.isStyleLoaded()) refreshData(minIdx, maxIdx);
  });

  // --- View toggle: map <-> list of crags visible in the current viewport ---
  for (const btn of document.querySelectorAll(".view-toggle-btn")) {
    btn.addEventListener("click", () => setView(btn.dataset.view));
  }

  if (!MAPBOX_TOKEN || MAPBOX_TOKEN.indexOf("PASTE_YOUR") === 0) {
    showError(
      "Kein Mapbox-Token gesetzt. Bitte in docs/app.js die Konstante " +
      "MAPBOX_TOKEN durch deinen eigenen Mapbox Public Access Token ersetzen " +
      "(siehe README.md)."
    );
    refreshData(startMin, startMax);
    return;
  }

  let savedStyleId = null;
  try {
    savedStyleId = localStorage.getItem(STYLE_STORAGE_KEY);
  } catch (err) {
    // localStorage can throw in some locked-down/private-browsing contexts -- ignore, just use the default.
  }
  const initialStyleId = MAP_STYLES.some((s) => s.id === savedStyleId) ? savedStyleId : DEFAULT_STYLE_ID;

  // Deep-link support: opening a shared #crag=<slug> URL (see shareCrag())
  // lands directly on that crag; a shared #view=lng,lat,zoom (see
  // shareCurrentView()) restores that viewport instead. #crag wins if both
  // are somehow present.
  let initialCenter = [10, 50];
  let initialZoom = 3.5;
  const cragParam = hashParams.get("crag");
  const target = cragParam ? findCragBySlug(crags, decodeURIComponent(cragParam)) : null;
  if (target && target.lat != null && target.lng != null) {
    initialCenter = [target.lng, target.lat];
    initialZoom = 14;
  } else {
    const viewFromHash = parseViewHashParam(hashParams);
    if (viewFromHash) {
      initialCenter = viewFromHash.center;
      initialZoom = viewFromHash.zoom;
    }
  }

  mapboxgl.accessToken = MAPBOX_TOKEN;
  map = new mapboxgl.Map({
    container: "map",
    style: `mapbox://styles/mapbox/${initialStyleId}`,
    center: initialCenter,
    zoom: initialZoom,
  });

  // Mapbox emits an "error" event per failed request -- e.g. individual
  // tiles occasionally 403 (missing bathymetry coverage at some
  // coordinates) even though the map works fine overall. Only surface the
  // blocking banner if the map never managed to load at all (bad/misconfigured
  // token); once the style has loaded once, treat further errors as
  // non-fatal noise and just log them.
  let mapLoaded = false;
  map.on("error", (e) => {
    console.error("Mapbox error:", e.error);
    if (mapLoaded) return;
    showError(
      "Mapbox-Fehler: " + (e.error && e.error.message ? e.error.message : String(e.error)) +
      " -- prüfe, ob dein Token gültig und für diese Domain freigegeben ist."
    );
  });

  map.addControl(new mapboxgl.NavigationControl(), "top-right");
  map.addControl(new mapboxgl.FullscreenControl(), "top-right");

  // Keep stats/list in sync with the viewport, not just the grade filter.
  map.on("moveend", () => {
    refreshStats();
    refreshList();
  });

  // Share the current viewport + grade filter (deliberately not the map
  // style -- that's a personal preference, not part of "this view").
  document.getElementById("share-view-btn").addEventListener("click", () => {
    const center = map.getCenter();
    const shareUrl = buildViewShareUrl(center.lng, center.lat, map.getZoom(), currentMinIdx, currentMaxIdx);
    shareLink({
      title: "The Topo Bouldergebietsuche",
      text: "Boulder-Gebiete auf The Topo Bouldergebietsuche",
      url: shareUrl,
    });
  });

  // Same radius scale for clusters (by "sum") and individual crags (by
  // "count") so marker size is directly comparable across both -- a lone
  // crag with 500 boulders should look as big as a cluster summing to 500.
  const radiusSteps = (property) => [
    "step", ["get", property],
    16, 100,
    20, 500,
    25, 2000,
    32,
  ];

  // (Re-)adds the crags source/layers. Needed on initial load AND after every
  // map.setStyle() call, since switching style wipes all custom sources/layers.
  function addCragLayers() {
    const { geojson } = buildGeoJSON(crags, currentMinIdx, currentMaxIdx);

    map.addSource("crags", {
      type: "geojson",
      data: geojson,
      cluster: true,
      clusterMaxZoom: 14,
      clusterRadius: 45,
      clusterProperties: {
        sum: ["+", ["get", "count"]],
      },
    });

    map.addLayer({
      id: "clusters",
      type: "circle",
      source: "crags",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": [
          "step", ["get", "sum"],
          "#7fb8e6", 100,
          "#4a90d9", 500,
          "#1a5fb4", 2000,
          "#0d3a73",
        ],
        "circle-radius": radiusSteps("sum"),
        "circle-stroke-width": 1,
        "circle-stroke-color": "#ffffff",
      },
    });

    map.addLayer({
      id: "cluster-count",
      type: "symbol",
      source: "crags",
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "sum"],
        "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"],
        "text-size": 12,
      },
      paint: { "text-color": "#ffffff" },
    });

    map.addLayer({
      id: "unclustered-point",
      type: "circle",
      source: "crags",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": "#e0692e",
        "circle-radius": radiusSteps("count"),
        "circle-stroke-width": 1,
        "circle-stroke-color": "#ffffff",
      },
    });

    map.addLayer({
      id: "unclustered-count",
      type: "symbol",
      source: "crags",
      filter: ["!", ["has", "point_count"]],
      layout: {
        "text-field": ["get", "count"],
        "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"],
        "text-size": 11,
      },
      paint: { "text-color": "#ffffff" },
    });

    refreshStats();
  }

  // Interaction handlers are registered once -- they reference layers by ID
  // and keep working across style switches since addCragLayers() re-creates
  // the same layer IDs every time.
  map.on("click", "clusters", (e) => {
    const features = map.queryRenderedFeatures(e.point, { layers: ["clusters"] });
    const clusterId = features[0].properties.cluster_id;
    map.getSource("crags").getClusterExpansionZoom(clusterId, (err, zoom) => {
      if (err) return;
      map.easeTo({ center: features[0].geometry.coordinates, zoom });
    });
  });

  // Click an individual crag marker -> open it on thetopo.com in a new tab.
  map.on("click", "unclustered-point", (e) => {
    const url = e.features[0].properties.url;
    window.open(url, "_blank", "noopener");
  });

  // Hover tooltips: crag name on individual markers, crag count on clusters.
  const hoverPopup = new mapboxgl.Popup({
    closeButton: false,
    closeOnClick: false,
    offset: 14,
  });

  map.on("mouseenter", "unclustered-point", (e) => {
    map.getCanvas().style.cursor = "pointer";
    const feature = e.features[0];
    hoverPopup
      .setLngLat(feature.geometry.coordinates)
      .setText(feature.properties.name)
      .addTo(map);
  });

  map.on("mouseenter", "clusters", (e) => {
    map.getCanvas().style.cursor = "pointer";
    const feature = e.features[0];
    const n = feature.properties.point_count;
    hoverPopup
      .setLngLat(feature.geometry.coordinates)
      .setText(`${n.toLocaleString("de-DE")} Gebiete`)
      .addTo(map);
  });

  for (const layerId of ["clusters", "unclustered-point"]) {
    map.on("mouseleave", layerId, () => {
      map.getCanvas().style.cursor = "";
      hoverPopup.remove();
    });
  }

  // "style.load" fires for the initial style AND after every map.setStyle().
  map.on("style.load", () => {
    mapLoaded = true;
    addCragLayers();
  });

  map.addControl(new StyleSwitcherControl(initialStyleId, (styleId) => {
    try {
      localStorage.setItem(STYLE_STORAGE_KEY, styleId);
    } catch (err) {
      // ignore -- persistence is a nice-to-have, not required
    }
    map.setStyle(`mapbox://styles/mapbox/${styleId}`);
  }), "top-right");
}

main();
