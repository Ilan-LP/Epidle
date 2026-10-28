import type { GameView, Projection } from "@epidle/api-client";
import { project } from "@epidle/api-client";
import { computeRates, createInitialState } from "@epidle/core";
import { renderToString } from "ink";
import { describe, expect, it } from "vitest";
import { WeekBanner } from "../Game";
import { Dashboard } from "./Dashboard";
import { MouliCheck } from "./MouliCheck";
import { Outdated } from "./Outdated";
import { osc52 } from "./Share";
import { Shop } from "./Shop";

// Smoke tests: the screens render a starting company with the expected French labels.

function projection(): Projection {
  const state = createInitialState();
  const view: GameView = {
    serverTime: 0,
    season: {
      id: 1,
      startsAt: 0,
      endsAt: 14 * 86_400_000,
      weeks: [
        {
          id: "soldes",
          name: "Soldes du BDE",
          description: "Embauches à -40 %.",
          effects: { hireCost: 0.6 },
        },
        null,
      ],
    },
    state,
    rates: computeRates(state),
  };
  return project({ view, receivedAt: 0 }, 0);
}

const noop = async () => undefined;

describe("screens", () => {
  it("dashboard shows the company and the pipeline side by side when wide", () => {
    const out = renderToString(
      <Dashboard p={projection()} act={noop} wide height={40} onShare={noop} />,
      {
        columns: 140,
      },
    );
    for (const label of ["Société", "Équipe", "Salles de formation", "Pipeline mouli"]) {
      expect(out).toContain(label);
    }
    expect(out).toContain("[e] Embaucher un junior");
    expect(out).toContain("[y] copier mon build");
    // A junior costs 25 x 1.1^2 x 0.6 during the soldes week (30,25 € otherwise).
    expect(out).toContain("18,15 €");
    expect(out).not.toContain("30,25 €");
  });

  it("announces the week, its exact effects and what comes next", () => {
    const game = {
      projection: projection(),
      error: null,
      log: [],
      act: noop,
      say: () => undefined,
    };
    const out = renderToString(<WeekBanner game={game} />, { columns: 200 });
    expect(out).toContain("Semaine 1/2 · Soldes du BDE (prix des embauches -40 %)");
    expect(out).toContain("ensuite : semaine normale");
  });

  it("an outdated CLI shows the server message and the update command", () => {
    const out = renderToString(<Outdated message="Ta version d'Epidle n'est plus supportée." />, {
      columns: 80,
    });
    expect(out).toContain("Nouvelle version d'Epidle");
    expect(out).toContain("Ta version d'Epidle n'est plus supportée.");
    expect(out).toContain("npx epidle@latest");
  });

  it("copies with an OSC 52 sequence", () => {
    expect(osc52("é")).toBe(`\x1b]52;c;${Buffer.from("é").toString("base64")}\x07`);
  });

  it("dashboard shows one pane at a time when narrow", () => {
    const out = renderToString(
      <Dashboard p={projection()} act={noop} wide={false} height={20} onShare={noop} />,
      {
        columns: 80,
      },
    );
    expect(out).toContain("Société");
    expect(out).not.toContain("Pipeline mouli");
  });

  it("shop lists every row with its price or lock", () => {
    const out = renderToString(
      <Shop p={projection()} act={noop} say={() => undefined} navigate={() => undefined} wide />,
      { columns: 140 },
    );
    expect(out).toContain("[1] Junior");
    expect(out).toContain("Salle de formation");
    expect(out).toMatch(/palier \S+/);
  });

  it("renders MouliCheck with challenge ascii art and prompt", () => {
    const challenge = {
      id: "ch-123",
      ascii: ["███", " █ ", " █ "],
      expiresIn: 120,
    };
    const out = renderToString(
      <MouliCheck challenge={challenge} onSolve={async () => ({ ok: true })} />,
      { columns: 80 },
    );
    expect(out).toContain("CONTRÔLE DE MOULI (Anti-Bot)");
    expect(out).toContain("Prouve ta présence humaine");
    expect(out).toContain("███");
    expect(out).toContain("code>");
  });
});
