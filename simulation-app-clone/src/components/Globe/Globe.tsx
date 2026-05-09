import { useEffect, useRef } from 'react';
import './Globe.css';

export interface LocationOption {
  id: string;
  name: string;
  lat: number;
  lng: number;
  ndviUrl: string;
  elevationUrl: string;
}

interface Props {
  locations: LocationOption[];
  onSelect: (loc: LocationOption) => void;
}

export default function Globe({ locations, onSelect }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    let cleanupFns: Array<() => void> = [];
    let cancelled = false;

    (async () => {
      const [globeMod, THREE] = await Promise.all([
        import('globe.gl'),
        import('three'),
      ]);
      if (cancelled) return;

      // globe.gl's default export is callable as `Globe()(element)` at runtime,
      // even though its TypeScript types describe it as a `new`-able class.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Globe = globeMod.default as unknown as () => (el: HTMLElement) => any;

      const el = mountRef.current;
      if (!el) return;

      const w = el.clientWidth;
      const h = el.clientHeight;

      const globe = Globe()(el)
        .globeImageUrl('/globe/earth-blue-marble.jpg')
        .bumpImageUrl('/globe/earth-topology.png')
        .backgroundImageUrl('/globe/night-sky.png')
        .showAtmosphere(true)
        .atmosphereColor('#1e90ff')
        .atmosphereAltitude(0.22)
        .pointsData(locations)
        .pointLat('lat')
        .pointLng('lng')
        .pointColor(() => '#ff6644')
        .pointAltitude(0.015)
        .pointRadius(0.55)
        .labelsData(locations)
        .labelLat('lat')
        .labelLng('lng')
        .labelText('name')
        .labelSize(1.4)
        .labelDotRadius(0.4)
        .labelColor(() => '#ffffff')
        .labelResolution(3)
        .labelAltitude(0.02)
        .pointLabel('name')
        .onPointClick((point: object) => {
          const loc = point as LocationOption;
          globe.pointOfView(
            { lat: loc.lat, lng: loc.lng, altitude: 1.2 },
            900
          );
          window.setTimeout(() => onSelectRef.current(loc), 950);
        })
        .onLabelClick((label: object) => {
          const loc = label as LocationOption;
          globe.pointOfView(
            { lat: loc.lat, lng: loc.lng, altitude: 1.2 },
            900
          );
          window.setTimeout(() => onSelectRef.current(loc), 950);
        })
        .pointOfView({ lat: 36, lng: -110, altitude: 2.2 })
        .width(w)
        .height(h);

      const ambientLight = new THREE.AmbientLight(0xffffff, 1.6);
      globe.scene().add(ambientLight);

      globe.controls().autoRotate = true;
      globe.controls().autoRotateSpeed = 0.35;
      globe.controls().enableZoom = true;

      // rAF-driven keyboard controls (held keys feel fluid)
      const ROTATE_SPEED = 0.04;
      const ZOOM_SPEED = 0.001;
      const MIN_ALT = 0.5;
      const MAX_ALT = 5.0;
      const DEFAULT_POV = { lat: 36, lng: -110, altitude: 2.2 };

      const held = new Set<string>();
      let lastTime: number | null = null;
      let rafId = 0;

      const tick = (now: number) => {
        rafId = requestAnimationFrame(tick);
        if (!held.size) {
          lastTime = null;
          return;
        }
        const dt = lastTime ? now - lastTime : 0;
        lastTime = now;
        if (!dt) return;

        const pov = globe.pointOfView();
        let { lat, lng, altitude } = pov;
        let changed = false;

        if (held.has('ArrowLeft')) {
          lng -= ROTATE_SPEED * dt;
          changed = true;
        }
        if (held.has('ArrowRight')) {
          lng += ROTATE_SPEED * dt;
          changed = true;
        }
        if (held.has('ArrowUp')) {
          lat = Math.min(lat + ROTATE_SPEED * dt, 90);
          changed = true;
        }
        if (held.has('ArrowDown')) {
          lat = Math.max(lat - ROTATE_SPEED * dt, -90);
          changed = true;
        }
        if (held.has('+') || held.has('=')) {
          altitude = Math.max(altitude - ZOOM_SPEED * dt, MIN_ALT);
          changed = true;
        }
        if (held.has('-') || held.has('_')) {
          altitude = Math.min(altitude + ZOOM_SPEED * dt, MAX_ALT);
          changed = true;
        }
        if (changed) globe.pointOfView({ lat, lng, altitude }, 0);
      };
      rafId = requestAnimationFrame(tick);

      const onKeyDown = (e: KeyboardEvent) => {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
          e.preventDefault();
        }
        if (
          ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_'].includes(e.key)
        ) {
          held.add(e.key);
          return;
        }
        if (e.key === 'r' || e.key === 'R') {
          globe.pointOfView(DEFAULT_POV, 1200);
        }
      };
      const onKeyUp = (e: KeyboardEvent) => {
        held.delete(e.key);
        if (e.key === '=') held.delete('+');
        if (e.key === '+') held.delete('=');
        if (e.key === '-') held.delete('_');
        if (e.key === '_') held.delete('-');
        if (!held.size) lastTime = null;
      };
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);

      const onResize = () => {
        if (!el) return;
        globe.width(el.clientWidth).height(el.clientHeight);
      };
      window.addEventListener('resize', onResize);

      cleanupFns.push(() => {
        cancelAnimationFrame(rafId);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('resize', onResize);
        const destructor = (globe as unknown as { _destructor?: () => void })._destructor;
        if (destructor) destructor();
      });
    })();

    return () => {
      cancelled = true;
      cleanupFns.forEach((fn) => fn());
      cleanupFns = [];
    };
  }, [locations]);

  return (
    <div className="globe-wrapper">
      <div className="globe-mount" ref={mountRef} />
      <div className="globe-overlay-top">
        <div className="globe-title">SELECT A LOCATION</div>
        <div className="globe-subtitle">Click a pin to launch a fire simulation on that landscape.</div>
      </div>
      <div className="globe-hints">
        <span>Click pin · simulate</span>
        <span>Arrow keys · rotate</span>
        <span>+ / − · zoom</span>
        <span>R · reset</span>
      </div>
    </div>
  );
}
