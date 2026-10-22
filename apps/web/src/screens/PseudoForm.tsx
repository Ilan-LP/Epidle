import { type FormEvent, useState } from "react";
import { ApiError, api, PSEUDO_RE } from "../api";

export function PseudoForm({
  current,
  onDone,
  onCancel,
}: {
  current: string | null;
  onDone: (pseudo: string) => void;
  onCancel?: () => void;
}) {
  const [value, setValue] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!PSEUDO_RE.test(value)) {
      setError("3 à 16 caractères : lettres sans accent, chiffres, _ ou -.");
      return;
    }
    setBusy(true);
    try {
      const r = await api.setPseudo(value);
      onDone(r.pseudo);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erreur inattendue.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="center" onSubmit={submit}>
      <p>
        {current ? "Nouveau pseudo :" : "Choisis ton pseudo. Il sera public dans le classement."}
      </p>
      <p className="prompt-line">
        <label htmlFor="pseudo">pseudo&gt;</label>
        <input
          id="pseudo"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          maxLength={16}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          // biome-ignore lint/a11y/noAutofocus: the only field of the screen
          autoFocus
        />
      </p>
      <p className="dim small">3 à 16 caractères : lettres sans accent, chiffres, _ ou -.</p>
      {error && <p className="bad">{error}</p>}
      <p>
        <button type="submit" className="btn" disabled={busy}>
          Valider
        </button>{" "}
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            Annuler
          </button>
        )}
      </p>
    </form>
  );
}
