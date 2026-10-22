import { GAME_NAME } from "@epidle/core";

export const LOGO = String.raw` _____       _     _ _
| ____|_ __ (_) __| | | ___
|  _| | '_ \| |/ _' | |/ _ \
| |___| |_) | | (_| | |  __/
|_____| .__/|_|\__,_|_|\___|
      |_|`;

export function Login({ error }: { error: boolean }) {
  return (
    <div className="center">
      <pre className="logo" role="img" aria-label={GAME_NAME}>
        {LOGO}
      </pre>
      <p>Monte ta boîte de dev. Forme tes juniors, règle tes moulis, livre du code propre.</p>
      <p>Le meilleur CA de la saison gagne.</p>
      {error && <p className="bad">La connexion a échoué, réessaie.</p>}
      <p>
        <a className="btn big" href="/api/auth/login">
          Se connecter avec Microsoft
        </a>
      </p>
      <p className="dim small">
        Compte Epitech obligatoire. Seul ton identifiant Microsoft anonyme est stocké, jamais ton
        nom ni ton email. Les autres joueurs ne voient que ton pseudo.
      </p>
    </div>
  );
}
