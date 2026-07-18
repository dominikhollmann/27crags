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

function buildGeoJSON(crags, minIdx, maxIdx) {
  const features = [];
  let totalBoulders = 0;

  for (const crag of crags) {
    if (crag.lat == null || crag.lng == null) continue;

    let count = 0;
    for (const [label, n] of Object.entries(crag.grades)) {
      const idx = gradeIndex(label);
      if (idx < 0) continue;
      if (idx >= minIdx && idx <= maxIdx) count += n;
    }
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

  function refreshData(minIdx, maxIdx) {
    const { geojson, matchingCragCount, totalBoulders } = buildGeoJSON(crags, minIdx, maxIdx);
    if (map) {
      const source = map.getSource("crags");
      if (source) source.setData(geojson);
    }
    updateStats(matchingCragCount, totalBoulders);
  }

  slider.noUiSlider.on("update", (values) => {
    const minIdx = Math.round(values[0]);
    const maxIdx = Math.round(values[1]);
    setRangeLabels(minIdx, maxIdx);
    if (!map || map.isStyleLoaded()) refreshData(minIdx, maxIdx);
  });

  if (!MAPBOX_TOKEN || MAPBOX_TOKEN.indexOf("PASTE_YOUR") === 0) {
    showError(
      "Kein Mapbox-Token gesetzt. Bitte in docs/app.js die Konstante " +
      "MAPBOX_TOKEN durch deinen eigenen Mapbox Public Access Token ersetzen " +
      "(siehe README.md)."
    );
    refreshData(observedMin, observedMax);
    return;
  }

  mapboxgl.accessToken = MAPBOX_TOKEN;
  map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/outdoors-v12",
    center: [10, 50],
    zoom: 3.5,
  });

  map.on("error", (e) => {
    showError(
      "Mapbox-Fehler: " + (e.error && e.error.message ? e.error.message : String(e.error)) +
      " -- prüfe, ob dein Token gültig und für diese Domain freigegeben ist."
    );
  });

  map.addControl(new mapboxgl.NavigationControl(), "top-right");
  map.addControl(new mapboxgl.FullscreenControl(), "top-right");

  // --- Map layers ---
  map.on("load", () => {
    const { geojson, matchingCragCount, totalBoulders } = buildGeoJSON(crags, observedMin, observedMax);

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
        "circle-radius": [
          "step", ["get", "sum"],
          16, 100,
          20, 500,
          25, 2000,
          32,
        ],
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
        "circle-radius": 12,
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

    // Click a cluster -> zoom in.
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
  });
}

main();
