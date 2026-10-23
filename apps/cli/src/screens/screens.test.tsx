import type { GameView, Projection } from "@epidle/api-client";
import { project } from "@epidle/api-client";
import { computeRates, createInitialState } from "@epidle/core";
import { renderToString } from "ink";
import { describe, expect, it } from "vitest";
import { Dashboard } from "./Dashboard";
import { Shop } from "./Shop";

// Smoke tests: the screens render a starting company with the expected French labels.

function projection(): Projection {
  const state = createInitialState();
  const view: GameView = {
    serverTime: 0,
    season: { id: 1, startsAt: 0, endsAt: 14 * 86_400_000 },
    state,
    rates: computeRates(state),
  };
  return project({ view, receivedAt: 0 }, 0);
}

const noop = async () => undefined;

describe("screens", () => {
  it("dashboard shows the company and the pipeline side by side when wide", () => {
    const out = renderToString(<Dashboard p={projection()} act={noop} wide height={40} />, {
      columns: 140,
    });
    for (const label of ["Société", "Équipe", "Salles de formation", "Pipeline mouli"]) {
      expect(out).toContain(label);
    }
    expect(out).toContain("[e] Embaucher un junior");
  });

  it("dashboard shows one pane at a time when narrow", () => {
    const out = renderToString(<Dashboard p={projection()} act={noop} wide={false} height={20} />, {
      columns: 80,
    });
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
});
