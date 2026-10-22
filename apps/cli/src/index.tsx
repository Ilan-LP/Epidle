import { GAME_NAME, type HealthResponse } from "@epidle/core";
import { Box, render, Text, useApp } from "ink";
import { useEffect, useState } from "react";

const SERVER_URL = process.env.EPIDLE_SERVER_URL ?? "http://localhost:3000";

type ServerStatus = "loading" | "online" | "offline";

function App() {
  const { exit } = useApp();
  const [status, setStatus] = useState<ServerStatus>("loading");

  useEffect(() => {
    fetch(`${SERVER_URL}/api/health`)
      .then((res) => (res.ok ? (res.json() as Promise<HealthResponse>) : Promise.reject()))
      .then(() => setStatus("online"))
      .catch(() => setStatus("offline"));
  }, []);

  useEffect(() => {
    if (status !== "loading") {
      exit();
    }
  }, [status, exit]);

  return (
    <Box flexDirection="column">
      <Text bold>{GAME_NAME}</Text>
      <Text>
        Serveur : {status === "loading" && <Text color="yellow">connexion…</Text>}
        {status === "online" && <Text color="green">en ligne</Text>}
        {status === "offline" && <Text color="red">hors ligne ({SERVER_URL})</Text>}
      </Text>
    </Box>
  );
}

render(<App />);
