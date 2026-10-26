import { UPDATE_COMMAND } from "@epidle/api-client";
import { Box, Text } from "ink";
import { A, T } from "../ui";

/** The server refuses this CLI version (426): its message, then the command to update. */
export function Outdated({ message }: { message: string }) {
  return (
    <Box flexDirection="column">
      <T tone="warn">Nouvelle version d'Epidle</T>
      <Text>{message}</Text>
      <Text> </Text>
      <A bold>{UPDATE_COMMAND}</A>
      <Text> </Text>
      <T tone="dim">[q] quitter</T>
    </Box>
  );
}
