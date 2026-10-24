import { useEffect, useState } from "react";

// Hash routes: no server config needed, and a build view link can be pasted in a chat.

export type Route =
  | { name: "dashboard" }
  | { name: "shop" }
  | { name: "leaderboard" }
  | { name: "player"; pseudo: string }
  | { name: "pseudo" }
  | { name: "help" };

/** A link pasted in a chat can be cut or garbled: a bad escape must not blank the page. */
function playerRoute(raw: string): Route {
  try {
    return { name: "player", pseudo: decodeURIComponent(raw) };
  } catch {
    return { name: "leaderboard" };
  }
}

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/");
  switch (parts[0]) {
    case "boutique":
      return { name: "shop" };
    case "classement":
      return { name: "leaderboard" };
    case "joueur":
      return parts[1] ? playerRoute(parts[1]) : { name: "leaderboard" };
    case "pseudo":
      return { name: "pseudo" };
    case "aide":
      return { name: "help" };
    default:
      return { name: "dashboard" };
  }
}

export function href(route: Route): string {
  switch (route.name) {
    case "dashboard":
      return "#/";
    case "shop":
      return "#/boutique";
    case "leaderboard":
      return "#/classement";
    case "player":
      return `#/joueur/${encodeURIComponent(route.pseudo)}`;
    case "pseudo":
      return "#/pseudo";
    case "help":
      return "#/aide";
  }
}

export const navigate = (route: Route) => {
  window.location.hash = href(route);
};

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
