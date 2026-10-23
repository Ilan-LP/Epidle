import { type Projection, shareText } from "@epidle/api-client";
import { Box, Text, useStdout } from "ink";
import { useEffect, useState } from "react";
import type { Navigate } from "../Game";
import { useClient } from "../hooks";
import { useKeys } from "../keys";
import { K, Panel, T } from "../ui";

/**
 * OSC 52: asks the terminal to put the text in the clipboard. Supported by most modern
 * terminals (Windows Terminal, iTerm2, kitty, WezTerm, Alacritty, foot...), ignored by others,
 * hence the text on screen too. Invisible, so it does not disturb Ink's drawing.
 */
export const osc52 = (text: string) => `\x1b]52;c;${Buffer.from(text).toString("base64")}\x07`;

/** "Copy my build": the Discord snapshot, sent to the clipboard and shown to copy by hand. */
export function Share({
  p,
  pseudo,
  navigate,
}: {
  p: Projection;
  pseudo: string;
  navigate: Navigate;
}) {
  const { api, server } = useClient();
  const { stdout } = useStdout();
  // Frozen when opened: the numbers keep moving, the copied text does not.
  const [snapshot] = useState(p);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .leaderboard("season")
      .then(
        (b) => b.me?.rank ?? null,
        () => null,
      )
      .then((rank) => {
        if (!alive) return;
        const t = shareText({ pseudo, p: snapshot, rank, webUrl: server });
        stdout.write(osc52(t));
        setText(t);
      });
    return () => {
      alive = false;
    };
  }, [api, server, pseudo, snapshot, stdout]);

  useKeys({ escape: () => navigate({ name: "dashboard" }) });

  return (
    <Panel title="Copier mon build">
      {text === null ? (
        <T tone="dim">préparation…</T>
      ) : (
        <>
          <T tone="ok">Copié dans le presse-papiers si ton terminal le permet (OSC 52).</T>
          <T tone="dim">Sinon, sélectionne le texte ci-dessous. Colle-le tel quel sur Discord.</T>
          <Box flexDirection="column" marginY={1}>
            {text.split("\n").map((line, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static lines
              <Text key={i}>{line}</Text>
            ))}
          </Box>
        </>
      )}
      <Text>
        <K k="Échap" /> retour
      </Text>
    </Panel>
  );
}
