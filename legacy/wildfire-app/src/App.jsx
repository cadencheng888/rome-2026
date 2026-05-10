import { Routes, Route, useParams } from "react-router-dom";
import Globe, { FIRE_LOCATIONS } from "./components/Globe/Globe";
import SimulationView from "./simulation/SimulationView";

function SimulationPage() {
  const { locationId } = useParams();
  const location = FIRE_LOCATIONS.find((l) => l.id === locationId);

  if (!location) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          background: "#0b0f14",
          color: "#8b949e",
          fontSize: 14,
          letterSpacing: 1,
        }}
      >
        Location not found.
      </div>
    );
  }

  return (
    <SimulationView
      tiffPath={location.tiffPath}
      locations={FIRE_LOCATIONS}
      selectedId={location.id}
    />
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Globe />} />
      <Route path="/simulation/:locationId" element={<SimulationPage />} />
    </Routes>
  );
}
