import type { MouliChallenge } from "@epidle/api-client";
import { useMemo, useState } from "react";
import { blockArt } from "../blockArt";

/** Quadrants are drawn taller than wide, like a terminal cell (about 1:2) but less stretched. */
const ROW_STRETCH = 1.5;

/** Scales with the box: full width on a phone, capped so it stays a code and not a banner. */
function ChallengeArt({ rows }: { rows: readonly string[] }) {
  const art = useMemo(() => blockArt(rows), [rows]);
  const height = art.height * ROW_STRETCH;
  return (
    <svg
      viewBox={`0 0 ${art.width} ${height}`}
      role="img"
      aria-label="Code à recopier"
      shapeRendering="crispEdges"
      style={{ display: "block", width: "100%", maxWidth: 420, height: "auto", userSelect: "none" }}
    >
      <path d={art.path} transform={`scale(1 ${ROW_STRETCH})`} fill="#e3b341" />
    </svg>
  );
}

/**
 * In-game Mouli Check overlay. Shown when the server returns 403 mouli_check_required
 * on an intent. The player must solve the ASCII challenge before they can act again.
 */
export function MouliCheckOverlay({
  challenge,
  onSolve,
  onRenew,
}: {
  challenge: MouliChallenge;
  onSolve: (answer: string) => Promise<{ ok: boolean; error?: string; remainingAttempts?: number }>;
  onRenew: () => Promise<boolean>;
}) {
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<"idle" | "busy" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const renew = async (reason: string | null = null) => {
    setStatus("busy");
    setValue("");
    const ok = await onRenew();
    setStatus(reason || !ok ? "error" : "idle");
    setErrorMsg(ok ? reason : "Impossible d'obtenir un nouveau code, réessaie.");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    setStatus("busy");
    setErrorMsg(null);
    const res = await onSolve(trimmed);
    if (!res.ok) {
      setValue("");
      setStatus("error");
      if (res.error === "invalid_code") {
        setErrorMsg(`Code incorrect ! Tentatives restantes : ${res.remainingAttempts ?? 0}`);
      } else if (res.error === "too_many_attempts") {
        await renew("Trop d'échecs : voici un nouveau code.");
      } else if (res.error === "expired" || res.error === "not_found") {
        await renew("Ce code a expiré : en voici un nouveau.");
      } else {
        setErrorMsg("Erreur de validation, réessaie.");
      }
    }
    // On success, the challenge is cleared by the parent hook — the overlay unmounts.
  };

  return (
    <div
      style={{
        maxWidth: 580,
        margin: "40px auto",
        padding: "24px",
        background: "#0d1117",
        border: "2px solid #e3b341",
        borderRadius: "8px",
        fontFamily: "monospace",
        color: "#e6edf3",
        boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 24 }}>🛡️</span>
        <h2 style={{ margin: 0, color: "#e3b341", fontSize: 18, textTransform: "uppercase" }}>
          Contrôle de Mouli (Anti-Bot)
        </h2>
      </div>
      <p style={{ margin: "4px 0 16px", color: "#8b949e", fontSize: 13 }}>
        Prouve ta présence humaine en recopiant le code ASCII affiché ci-dessous :
      </p>

      <div
        style={{
          background: "#161b22",
          border: "1px solid #30363d",
          borderRadius: 6,
          padding: "16px 20px",
          marginBottom: 20,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <ChallengeArt rows={challenge.ascii} />
      </div>

      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "#58a6ff", fontWeight: "bold" }}>code&gt;</span>
          <input
            type="text"
            value={value}
            onChange={(e) => {
              setValue(e.target.value.toUpperCase().slice(0, 8));
              if (status === "error") setStatus("idle");
            }}
            placeholder="Ex: 7K4B"
            autoFocus
            disabled={status === "busy"}
            style={{
              flex: 1,
              minWidth: 0,
              background: "#0d1117",
              border: "1px solid #30363d",
              color: "#e6edf3",
              padding: "8px 12px",
              fontFamily: "monospace",
              fontSize: 16,
              fontWeight: "bold",
              borderRadius: 4,
              outline: "none",
            }}
          />
          <button
            type="submit"
            disabled={status === "busy"}
            style={{
              background: "#238636",
              color: "#ffffff",
              border: "none",
              padding: "8px 16px",
              borderRadius: 4,
              cursor: "pointer",
              fontWeight: "bold",
              fontSize: 14,
              opacity: status === "busy" ? 0.6 : 1,
            }}
          >
            {status === "busy" ? "…" : "Valider"}
          </button>
        </div>

        {errorMsg && (
          <div
            style={{
              padding: "10px 14px",
              background: "rgba(248, 81, 73, 0.15)",
              border: "1px solid #f85149",
              borderRadius: 4,
              color: "#ff7b72",
              fontSize: 13,
            }}
          >
            ❌ {errorMsg}
          </div>
        )}

        <div style={{ color: "#8b949e", fontSize: 12, marginTop: 4 }}>
          [Entrée] pour valider · Expire dans {challenge.expiresIn}s ·{" "}
          <button
            type="button"
            style={{
              background: "none",
              border: "none",
              padding: 0,
              color: "#58a6ff",
              font: "inherit",
              textDecoration: "underline",
              cursor: "pointer",
            }}
            onClick={() => void renew()}
            disabled={status === "busy"}
          >
            code illisible ? nouveau code
          </button>
        </div>
      </form>
    </div>
  );
}
