import { GAME_NAME, type HealthResponse } from "@epidle/core";
import { useEffect, useState } from "react";

type ServerStatus = "loading" | "online" | "offline";

const STATUS_LABEL: Record<ServerStatus, string> = {
  loading: "connexion…",
  online: "en ligne",
  offline: "hors ligne",
};

export function App() {
  const [status, setStatus] = useState<ServerStatus>("loading");

  useEffect(() => {
    fetch("/api/health")
      .then((res) => (res.ok ? (res.json() as Promise<HealthResponse>) : Promise.reject()))
      .then(() => setStatus("online"))
      .catch(() => setStatus("offline"));
  }, []);

  return (
    <main>
      <h1>{GAME_NAME}</h1>
      <p>Serveur : {STATUS_LABEL[status]}</p>
    </main>
  );
}
