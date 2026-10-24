import { useShortcuts } from "../keys";
import { href, navigate } from "../router";
import { Btn, Key, Panel } from "../ui";

const SHORTCUTS: [string, string][] = [
  ["t", "tableau de bord"],
  ["b", "boutique"],
  ["c", "classement"],
  ["?", "aide"],
  ["l", "langage suivant (cosmétique)"],
  ["e", "embaucher un junior (tableau)"],
  ["y", "copier mon build pour Discord (tableau)"],
  ["f", "lancer la formation choisie (tableau)"],
  ["1-4", "sévérité du stage n (tableau)"],
  ["1-8", "acheter la ligne n (boutique)"],
  ["⇧5-8", "version suivante d'une mouli (boutique)"],
  ["x", "quantité x1 / x10 / x100 / max (boutique)"],
  ["v", "saison / général (classement)"],
  ["Esc", "retour"],
];

export function Help({
  pseudo,
  onLogout,
}: {
  pseudo: string;
  onLogout: (everywhere?: boolean) => void;
}) {
  useShortcuts({ escape: () => navigate({ name: "dashboard" }) });
  return (
    <div className="grid">
      <Panel title="Règles">
        <ul className="list bullets">
          <li>Tes devs écrivent du code (LoC/s). Le code passe par les moulis, puis est livré.</li>
          <li>Le code livré rapporte de l'argent, multiplié par sa qualité : chaque bug coûte.</li>
          <li>
            Une mouli attrape une partie des bugs et rend le code plus précieux, mais elle a une
            capacité. Le surplus part sans vérification.
          </li>
          <li>
            Former un dev double sa production, et chaque niveau prend deux fois plus de temps.
          </li>
          <li>
            Tout continue quand tu n'es pas là. Le score est le CA cumulé de la saison (14 jours).
          </li>
          <li>
            En fin de saison tout repart à zéro, sauf tes badges : top 10, Licorne, dev Légende.
          </li>
          <li>Cliquer ne sert à rien : ce sont tes décisions qui comptent.</li>
        </ul>
      </Panel>
      <Panel title="Raccourcis">
        <table className="table">
          <tbody>
            {SHORTCUTS.map(([k, label]) => (
              <tr key={k}>
                <td>
                  <Key k={k} />
                </td>
                <td>{label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel title="Profil">
        <p>
          Connecté en tant que <strong>{pseudo}</strong>.
        </p>
        <p>
          <a className="btn" href={href({ name: "pseudo" })}>
            Changer de pseudo
          </a>{" "}
          <Btn onClick={() => onLogout()}>Se déconnecter</Btn>{" "}
          <Btn onClick={() => onLogout(true)}>Se déconnecter partout</Btn>
        </p>
        <p className="dim small">
          Seul ton identifiant Microsoft (anonyme) et ton pseudo sont stockés. Le langage choisi ne
          change que l'affichage.
        </p>
      </Panel>
    </div>
  );
}
