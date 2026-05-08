import { useEffect, useRef } from "react";
import "./Globe.css";

// Cities to label + connect with arcs
const CITIES = [
  { name: "Dubai", lat: 25.2048, lng: 55.2708 },
  { name: "Mumbai", lat: 19.076, lng: 72.8777 },
  { name: "Bangkok", lat: 13.7563, lng: 100.5018 },
  { name: "Shanghai", lat: 31.2304, lng: 121.4737 },
  { name: "Seoul", lat: 37.5665, lng: 126.978 },
];

export default function Globe() {
  const mountRef = useRef(null);
  const globeRef = useRef(null);

  useEffect(() => {
    let Globe, THREE, renderer, scene, camera, animId;

    async function init() {
      // Dynamically import so it doesn't break SSR
      const [globeMod, threeMod] = await Promise.all([
        import("globe.gl"),
        import("three"),
      ]);
      Globe = globeMod.default;
      THREE = threeMod;

      const el = mountRef.current;
      if (!el) return;

      const w = el.clientWidth;
      const h = el.clientHeight;

      const globe = Globe()(el)
        // ── Earth textures ──────────────────────────────────────────
        .globeImageUrl(
          "https://unpkg.com/three-globe/example/img/earth-night.jpg"
        )
        .bumpImageUrl(
          "https://unpkg.com/three-globe/example/img/earth-topology.png"
        )
        .backgroundImageUrl(
          "https://unpkg.com/three-globe/example/img/night-sky.png"
        )
        // ── Atmosphere ───────────────────────────────────────────────
        .showAtmosphere(true)
        .atmosphereColor("#1e90ff")
        .atmosphereAltitude(0.22)
        // ── City dots ────────────────────────────────────────────────
        .pointsData(CITIES)
        .pointLat("lat")
        .pointLng("lng")
        .pointColor(() => "#00e5ff")
        .pointAltitude(0.01)
        .pointRadius(0.35)
        // ── City labels ──────────────────────────────────────────────
        .labelsData(CITIES)
        .labelLat("lat")
        .labelLng("lng")
        .labelText("name")
        .labelSize(1.4)
        .labelDotRadius(0.4)
        .labelColor(() => "#ffffff")
        .labelResolution(3)
        .labelAltitude(0.02)
        // ── Camera ───────────────────────────────────────────────────
        .pointOfView({ lat: 20, lng: 90, altitude: 2.2 })
        .width(w)
        .height(h);

      globeRef.current = globe;

      // Slow auto-rotate
      globe.controls().autoRotate = true;
      globe.controls().autoRotateSpeed = 0.4;
      globe.controls().enableZoom = true;

      // Resize handler
      const onResize = () => {
        if (!el) return;
        globe.width(el.clientWidth).height(el.clientHeight);
      };
      window.addEventListener("resize", onResize);

      return () => {
        window.removeEventListener("resize", onResize);
        globe._destructor?.();
      };
    }

    const cleanup = init();
    return () => {
      cleanup.then((fn) => fn?.());
    };
  }, []);

  return (
    <div className="globe-wrapper">
      <div className="globe-mount" ref={mountRef} />
    </div>
  );
}
