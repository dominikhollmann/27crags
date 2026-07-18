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

const LIST_MAX_ITEMS = 300;

// `bounds` is a mapboxgl.LngLatBounds, or null when there's no map (no
// token) -- in that case every crag counts as "visible".
function computeListItems(crags, minIdx, maxIdx, bounds) {
  const items = [];
  for (const crag of crags) {
    if (crag.lat == null || crag.lng == null) continue;
    if (bounds && !bounds.contains([crag.lng, crag.lat])) continue;

    const count = countInRange(crag, minIdx, maxIdx);
    if (count <= 0) continue;

    items.push({ name: crag.name, region: crag.region, country: crag.country, url: crag.url, count });
  }
  items.sort((a, b) => b.count - a.count);
  return items;
}

function renderList(items) {
  const container = document.getElementById("list-items");
  container.innerHTML = "";

  const shown = items.slice(0, LIST_MAX_ITEMS);
  for (const item of shown) {
    const a = document.createElement("a");
    a.className = "list-item";
    a.href = item.url;
    a.target = "_blank";
    a.rel = "noopener";
    a.innerHTML =
      `<div><div class="list-item-name"></div><div class="list-item-location"></div></div>` +
      `<div class="list-item-count"></div>`;
    a.querySelector(".list-item-name").textContent = item.name;
    a.querySelector(".list-item-location").textContent = `${item.region}, ${item.country}`;
    a.querySelector(".list-item-count").textContent = item.count.toLocaleString("de-DE");
    container.appendChild(a);
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

  let crags;
  try {
    crags = await loadCrags();
  } catch (err) {
    showError("Boulder-Daten konnten nicht geladen werden: " + err.message);
    return;
  }

  const [observedMin, observedMax] = computeObservedRange(crags);
  const statsEl = document.getElementById("stats");

  // --- Slider setup (independent of Mapbox so it still works if the map fails) ---
  const slider = document.getElementById("grade-slider");
  const minLabelEl = document.getElementById("grade-min-label");
  const maxLabelEl = document.getElementById("grade-max-label");

  noUiSlider.create(slider, {
    start: [observedMin, observedMax],
    connect: true,
    step: 1,
    range: { min: observedMin, max: observedMax },
    tooltips: false,
  });

  function setRangeLabels(minIdx, maxIdx) {
    minLabelEl.textContent = FONT_SEQUENCE[minIdx];
    maxLabelEl.textContent = FONT_SEQUENCE[maxIdx];
  }
  setRangeLabels(observedMin, observedMax);

  function updateStats(matchingCragCount, totalBoulders) {
    statsEl.textContent =
      `${matchingCragCount.toLocaleString("de-DE")} von ${crags.length.toLocaleString("de-DE")} Gebieten -- ` +
      `${totalBoulders.toLocaleString("de-DE")} Boulder im gewählten Bereich`;
  }

  // `map` is assigned below only if a Mapbox token is present; refreshData
  // guards against it being null so the slider/stats stay usable either way.
  let map = null;
  let currentView = "map";
  let currentMinIdx = observedMin;
  let currentMaxIdx = observedMax;

  function refreshList() {
    if (currentView !== "list") return;
    const bounds = map ? map.getBounds() : null;
    renderList(computeListItems(crags, currentMinIdx, currentMaxIdx, bounds));
  }

  function refreshData(minIdx, maxIdx) {
    currentMinIdx = minIdx;
    currentMaxIdx = maxIdx;
    const { geojson, matchingCragCount, totalBoulders } = buildGeoJSON(crags, minIdx, maxIdx);
    if (map) {
      const source = map.getSource("crags");
      if (source) source.setData(geojson);
    }
    updateStats(matchingCragCount, totalBoulders);
    refreshList();
  }

  slider.noUiSlider.on("update", (values) => {
    const minIdx = Math.round(values[0]);
    const maxIdx = Math.round(values[1]);
    setRangeLabels(minIdx, maxIdx);
    if (!map || map.isStyleLoaded()) refreshData(minIdx, maxIdx);
  });

  // --- View toggle: map <-> list of crags visible in the current viewport ---
  const listView = document.getElementById("list-view");
  for (const btn of document.querySelectorAll(".view-toggle-btn")) {
    btn.addEventListener("click", () => {
      currentView = btn.dataset.view;
      for (const b of document.querySelectorAll(".view-toggle-btn")) {
        b.classList.toggle("active", b === btn);
      }
      listView.classList.toggle("hidden", currentView !== "list");
      if (currentView === "list") refreshList();
    });
  }

  if (!MAPBOX_TOKEN || MAPBOX_TOKEN.indexOf("PASTE_YOUR") === 0) {
    showError(
      "Kein Mapbox-Token gesetzt. Bitte in docs/app.js die Konstante " +
      "MAPBOX_TOKEN durch deinen eigenen Mapbox Public Access Token ersetzen " +
      "(siehe README.md)."
    );
    refreshData(observedMin, observedMax);
    return;
  }

  let savedStyleId = null;
  try {
    savedStyleId = localStorage.getItem(STYLE_STORAGE_KEY);
  } catch (err) {
    // localStorage can throw in some locked-down/private-browsing contexts -- ignore, just use the default.
  }
  const initialStyleId = MAP_STYLES.some((s) => s.id === savedStyleId) ? savedStyleId : DEFAULT_STYLE_ID;

  mapboxgl.accessToken = MAPBOX_TOKEN;
  map = new mapboxgl.Map({
    container: "map",
    style: `mapbox://styles/mapbox/${initialStyleId}`,
    center: [10, 50],
    zoom: 3.5,
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
    const { geojson, matchingCragCount, totalBoulders } = buildGeoJSON(crags, currentMinIdx, currentMaxIdx);

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

    updateStats(matchingCragCount, totalBoulders);
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
