import { ApiError, PSEUDO_RE } from "@epidle/api-client";
import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { useClient } from "../hooks";
import { A, T } from "../ui";

const RULE = "3 à 16 caractères : lettres sans accent, chiffres, _ ou -.";
const ALLOWED = /^[A-Za-z0-9_-]+$/;

/** Owns the keyboard while shown: the parent turns its shortcuts off. */
export function PseudoForm({
  current,
  onDone,
  onCancel,
}: {
  current: string | null;
  onDone: (pseudo: string) => void;
  onCancel?: () => void;
}) {
  const { api } = useClient();
  const [value, setValue] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!PSEUDO_RE.test(value)) {
      setError(RULE);
      return;
    }
    setBusy(true);
    try {
      onDone((await api.setPseudo(value)).pseudo);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Erreur inattendue.");
      setBusy(false);
    }
  };

  useInput(
    (input, key) => {
      if (key.return) return submit();
      if (key.escape) return onCancel?.();
      const edit = (change: (v: string) => string) => {
        setValue((v) => change(v).slice(0, 16));
        setError(null);
      };
      if (key.backspace || key.delete) edit((v) => v.slice(0, -1));
      else if (!key.ctrl && !key.meta && ALLOWED.test(input)) edit((v) => v + input);
    },
    { isActive: !busy },
  );

  return (
    <Box flexDirection="column">
      <Text>
        {current ? "Nouveau pseudo :" : "Choisis ton pseudo. Il sera public dans le classement."}
      </Text>
      <Text> </Text>
      <Text>
        <A>pseudo&gt;</A> {value}
        <A>_</A>
      </Text>
      <T tone={error === RULE ? "bad" : "dim"}>{RULE}</T>
      {error && error !== RULE && <T tone="bad">{error}</T>}
      <Text> </Text>
      <T tone="dim">[Entrée] valider{onCancel ? " · [Échap] annuler" : " · [Ctrl+C] quitter"}</T>
    </Box>
  );
}
