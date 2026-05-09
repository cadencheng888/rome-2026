import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import "./Globe.css";

// Each entry needs an id (used as route param) and optional tiffPath
// (set tiffPath to the public URL of the pre-processed .tiff once the
//  Python script has generated it; null = random-forest fallback)
export const FIRE_LOCATIONS = [
  {
    id: "pacific-palisades",
    name: "Pacific Palisades, CA",
    lat: 34.047,
    lng: -118.526,
    tiffPath: "/tiffs/palisades.tif",
  },
  {
    id: "paradise",
    name: "Paradise, CA",
    lat: 39.7596,
    lng: -121.6219,
    tiffPath: null,
  },
  {
    id: "lahaina",
    name: "Lahaina, Maui, HI",
    lat: 20.8783,
    lng: -156.6825,
    tiffPath: null,
  },
  {
    id: "gatlinburg",
    name: "Gatlinburg, TN",
    lat: 35.7143,
    lng: -83.5102,
    tiffPath: null,
  },
  {
    id: "fort-mcmurray",
    name: "Fort McMurray, Canada",
    lat: 56.7265,
    lng: -111.3803,
    tiffPath: null,
  },
  {
    id: "valparaiso",
    name: "Valparaiso, Chile",
    lat: -33.0472,
    lng: -71.6127,
    tiffPath: null,
  },
  {
    id: "mati",
    name: "Mati, Greece",
    lat: 38.0717,
    lng: 23.9691,
    tiffPath: null,
  },
  {
    id: "blue-mountains",
    name: "Blue Mountains, Australia",
    lat: -33.6994,
    lng: 150.5684,
    tiffPath: null,
  },
  {
    id: "amazon",
    name: "Amazon Basin, Brazil",
    lat: -3.4653,
    lng: -62.2159,
    tiffPath: null,
  },
  {
    id: "krasnoyarsk",
    name: "Krasnoyarsk, Russia",
    lat: 60.0,
    lng: 97.0,
    tiffPath: null,
  },
];

export default function Globe() {
  const mountRef = useRef(null);
  const globeRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    async function init() {
      const [globeMod, threeMod] = await Promise.all([
        import("globe.gl"),
        import("three"),
      ]);
      const GlobeLib = globeMod.default;
      const THREE = threeMod;

      const el = mountRef.current;
      if (!el) return;

      const w = el.clientWidth;
      const h = el.clientHeight;

      const navigateToLocation = (location) => {
        globe.pointOfView(
          { lat: location.lat, lng: location.lng, altitude: 1.2 },
          1200
        );
        setTimeout(() => {
          navigate(`/simulation/${location.id}`);
        }, 1200);
      };

      const globe = GlobeLib()(el)
        .globeImageUrl(
          "https://unpkg.com/three-globe/example/img/earth-night.jpg"
        )
        .bumpImageUrl(
          "https://unpkg.com/three-globe/example/img/earth-topology.png"
        )
        .backgroundImageUrl(
          "https://unpkg.com/three-globe/example/img/night-sky.png"
        )
        .showAtmosphere(true)
        .atmosphereColor("#1e90ff")
        .atmosphereAltitude(0.22)
        .pointsData(FIRE_LOCATIONS)
        .pointLat("lat")
        .pointLng("lng")
        .pointColor(() => "#00e5ff")
        .pointAltitude(0.01)
        .pointRadius(0.35)
        .labelsData(FIRE_LOCATIONS)
        .labelLat("lat")
        .labelLng("lng")
        .labelText("name")
        .labelSize(1.4)
        .labelDotRadius(0.4)
        .labelColor(() => "#ffffff")
        .labelResolution(3)
        .labelAltitude(0.02)
        .onPointClick((point) => navigateToLocation(point))
        .onLabelClick((label) => navigateToLocation(label))
        .pointLabel("name")
        .pointOfView({ lat: 20, lng: 90, altitude: 2.2 })
        .width(w)
        .height(h);

      globeRef.current = globe;

      const ambientLight = new THREE.AmbientLight(0xffffff, 1.8);
      globe.scene().add(ambientLight);

      globe.controls().autoRotate = true;
      globe.controls().autoRotateSpeed = 0.4;
      globe.controls().enableZoom = true;

      const ROTATE_SPEED = 0.04;
      const ZOOM_SPEED = 0.001;
      const MIN_ALT = 0.5;
      const MAX_ALT = 5.0;
      const DEFAULT_POV = { lat: 20, lng: 90, altitude: 2.2 };

      const held = new Set();
      let lastTime = null;
      let rafId = null;

      const tick = (now) => {
        rafId = requestAnimationFrame(tick);
        if (!held.size) {
          lastTime = null;
          return;
        }
        const dt = lastTime ? now - lastTime : 0;
        lastTime = now;
        if (!dt) return;

        let { lat, lng, altitude } = globe.pointOfView();
        let changed = false;

        if (held.has("ArrowLeft")) {
          lng -= ROTATE_SPEED * dt;
          changed = true;
        }
        if (held.has("ArrowRight")) {
          lng += ROTATE_SPEED * dt;
          changed = true;
        }
        if (held.has("ArrowUp")) {
          lat = Math.min(lat + ROTATE_SPEED * dt, 90);
          changed = true;
        }
        if (held.has("ArrowDown")) {
          lat = Math.max(lat - ROTATE_SPEED * dt, -90);
          changed = true;
        }
        if (held.has("+") || held.has("=")) {
          altitude = Math.max(altitude - ZOOM_SPEED * dt, MIN_ALT);
          changed = true;
        }
        if (held.has("-") || held.has("_")) {
          altitude = Math.min(altitude + ZOOM_SPEED * dt, MAX_ALT);
          changed = true;
        }

        if (changed) globe.pointOfView({ lat, lng, altitude }, 0);
      };

      rafId = requestAnimationFrame(tick);

      const onKeyDown = (e) => {
        if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")
          return;
        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key))
          e.preventDefault();
        if (
          [
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "ArrowDown",
            "+",
            "=",
            "-",
            "_",
          ].includes(e.key)
        ) {
          held.add(e.key);
          return;
        }
        const keyNum = Number(e.key);
        if (!isNaN(keyNum) && keyNum >= 0 && keyNum < FIRE_LOCATIONS.length) {
          globe.pointOfView(
            {
              lat: FIRE_LOCATIONS[keyNum].lat,
              lng: FIRE_LOCATIONS[keyNum].lng,
              altitude: 1.2,
            },
            1200
          );
        }
        if (e.key === "r" || e.key === "R")
          globe.pointOfView(DEFAULT_POV, 1200);
      };

      const onKeyUp = (e) => {
        held.delete(e.key);
        if (e.key === "=") held.delete("+");
        if (e.key === "+") held.delete("=");
        if (e.key === "-") held.delete("_");
        if (e.key === "_") held.delete("-");
        if (!held.size) lastTime = null;
      };

      const onResize = () => {
        if (!el) return;
        globe.width(el.clientWidth).height(el.clientHeight);
      };

      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);
      window.addEventListener("resize", onResize);

      return () => {
        cancelAnimationFrame(rafId);
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
        window.removeEventListener("resize", onResize);
        globe._destructor?.();
      };
    }

    const cleanupPromise = init();
    return () => {
      cleanupPromise.then((fn) => fn?.());
    };
  }, [navigate]);

  return (
    <div className="globe-wrapper">
      <div className="globe-mount" ref={mountRef} />
      <div className="globe-hints">
        <span>Arrow keys — rotate</span>
        <span>+ / — — zoom</span>
        <span>0-9 — jump to city</span>
        <span>R — reset view</span>
        <span style={{ color: "#00e5ff" }}>Click a dot to simulate</span>
      </div>
    </div>
  );
}
