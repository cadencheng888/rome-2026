import { useEffect, useRef } from "react";
import "./Globe.css";

const TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

export default function Globe() {
  const containerRef = useRef(null);
  const globeRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || globeRef.current) return;

    let globe;

    async function initGlobe() {
      const og = await import("@openglobus/og");
      const { Globe, XYZ, GlobusTerrain, control } = og;

      const satellite = new XYZ("ESRI Satellite", {
        isBaseLayer: true,
        url: TILE_URL,
        visibility: true,
        attribution: "ESRI World Imagery",
      });

      globe = new Globe({
        target: containerRef.current,
        name: "Earth",
        terrain: new GlobusTerrain(),
        layers: [satellite],
        controls: [
          new control.MouseNavigation({ autoActivate: true }),
          new control.TouchNavigation({ autoActivate: true }),
          new control.KeyboardNavigation({ autoActivate: true }),
          new control.ZoomControl({ autoActivate: true }),
          new control.Sun({ autoActivate: true }),
        ],
      });

      globeRef.current = globe;
    }

    initGlobe();

    return () => {
      if (containerRef.current) containerRef.current.innerHTML = "";
      globeRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className="globe-container" />;
}
