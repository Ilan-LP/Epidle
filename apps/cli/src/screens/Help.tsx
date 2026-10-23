import { Box, Text } from "ink";
import { useState } from "react";
import type { Navigate } from "../Game";
import { useClient } from "../hooks";
import { useKeys } from "../keys";
import { A, col, K, Panel, T } from "../ui";

const SHORTCUTS: [string, string][] = [
  ["t b c ?", "tableau, boutique, classement, aide"],
  ["l", "langage suivant (cosmétique)"],
  ["q", "quitter (le jeu continue sans toi)"],
  ["e", "embaucher un junior (tableau)"],
  ["y", "copier mon build pour Discord (tableau)"],
  ["←→ ↑↓", "dev à former et niveau cible (tableau)"],
  ["f", "lancer la formation choisie (tableau)"],
  ["1-4", "sévérité du stage n (tableau)"],
  ["tab", "société / pipeline si le terminal est étroit"],
  ["↑↓ Entrée", "choisir et acheter (boutique, classement)"],
  ["1-8", "acheter la ligne n (boutique)"],
  ["x", "quantité x1 / x10 / x100 / max (boutique)"],
  ["v", "saison / général (classement)"],
  ["PgUp PgDn", "faire défiler si le terminal est petit"],
  ["Échap", "retour"],
];

const RULES = [
  "Tes devs écrivent du code (LoC/s). Le code passe par les moulis, puis est livré.",
  "Le code livré rapporte de l'argent, multiplié par sa qualité : chaque bug coûte.",
  "Une mouli attrape une partie des bugs, mais elle a une capacité. Le surplus part sans vérification.",
  "Former un dev double sa production, et chaque niveau prend deux fois plus de temps.",
  "Tout continue quand tu n'es pas là. Le score est le CA cumulé de la saison (14 jours).",
  "Cliquer ne sert à rien : ce sont tes décisions qui comptent.",
];

export function Help({
  pseudo,
  navigate,
  onLogout,
  wide,
}: {
  pseudo: string;
  navigate: Navigate;
  onLogout: () => void;
  wide: boolean;
}) {
  const { server } = useClient();
  const [confirm, setConfirm] = useState(false);
  useKeys({
    p: () => navigate({ name: "pseudo" }),
    d: () => (confirm ? onLogout() : setConfirm(true)),
    escape: () => (confirm ? setConfirm(false) : navigate({ name: "dashboard" })),
  });

  return (
    <Box flexDirection={wide ? "row" : "column"}>
      <Box flexDirection="column" width={wide ? "50%" : undefined}>
        <Panel title="Règles">
          {RULES.map((r) => (
            <Text key={r}>· {r}</Text>
          ))}
        </Panel>
        <Panel title="Profil">
          <Text>
            Connecté en tant que <Text bold>{pseudo}</Text> <T tone="dim">sur {server}</T>
          </Text>
          <Text>
            <K k="p" /> changer de pseudo <K k="d" />{" "}
            {confirm ? (
              <T tone="warn">appuie encore sur d pour te déconnecter</T>
            ) : (
              "se déconnecter"
            )}
          </Text>
          <T tone="dim">
            Seul ton identifiant Microsoft (anonyme) et ton pseudo sont stockés. Le langage choisi
            ne change que l'affichage.
          </T>
        </Panel>
      </Box>
      <Box flexDirection="column" width={wide ? "50%" : undefined}>
        <Panel title="Raccourcis">
          {SHORTCUTS.map(([k, label]) => (
            <Text key={k} wrap="truncate">
              <A>{col(`[${k}]`, 12)}</A>
              {label}
            </Text>
          ))}
        </Panel>
      </Box>
    </Box>
  );
}
