import type { MouliChallenge } from "@epidle/api-client";
import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { A, T } from "../ui";

const ALLOWED = /^[A-Za-z0-9]+$/;

export function MouliCheck({
  challenge,
  onSolve,
}: {
  challenge: MouliChallenge;
  onSolve: (answer: string) => Promise<{ ok: boolean; error?: string; remainingAttempts?: number }>;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError("Tape le code affiché.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await onSolve(trimmed);
    if (!res.ok) {
      setBusy(false);
      setValue("");
      if (res.error === "invalid_code") {
        setError(`Code incorrect ! Tentatives restantes : ${res.remainingAttempts ?? 0}`);
      } else if (res.error === "too_many_attempts") {
        setError("Trop d'échecs. Un nouveau défi a été généré.");
      } else if (res.error === "expired") {
        setError("Ce défi a expiré.");
      } else {
        setError("Erreur de validation, réessaie.");
      }
    }
  };

  useInput(
    (input, key) => {
      if (key.return) return void submit();
      if (key.backspace || key.delete) {
        setValue((v) => v.slice(0, -1));
        setError(null);
      } else if (!key.ctrl && !key.meta && ALLOWED.test(input)) {
        setValue((v) => (v + input).slice(0, 8));
        setError(null);
      }
    },
    { isActive: !busy },
  );

  return (
    <Box flexDirection="column" paddingY={1} paddingX={2} borderStyle="round" borderColor="yellow">
      <Text bold color="yellow">
        🛡️ CONTRÔLE DE MOULI (Anti-Bot)
      </Text>
      <T tone="dim">Prouve ta présence humaine en recopiant les 4 caractères ci-dessous :</T>
      <Text> </Text>
      {challenge.ascii.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static lines
        <Text key={i} bold>
          {line}
        </Text>
      ))}
      <Text> </Text>
      <Text>
        <A>code&gt;</A> <Text bold>{value.toUpperCase()}</Text>
        <A>_</A>
      </Text>
      {error && <T tone="bad">{error}</T>}
      <Text> </Text>
      <T tone="dim">[Entrée] valider · [Retour] effacer</T>
    </Box>
  );
}
