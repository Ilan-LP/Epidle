import { ApiError, type DeviceLogin, formatDuration, isOutdated, LOGO } from "@epidle/api-client";
import { Box, Text, useApp } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";
import { openBrowser } from "../browser";
import { useClient } from "../hooks";
import { useKeys } from "../keys";
import { A, K, T } from "../ui";

type Step =
  | { name: "starting" }
  | { name: "waiting"; login: DeviceLogin; expiresAt: number }
  | { name: "failed"; message: string };

/** Device code flow: the player logs in on any browser, this terminal polls the server. */
export function Login({
  onToken,
  onOutdated,
}: {
  onToken: (token: string) => void;
  /** The server refuses this CLI version: App shows how to update instead. */
  onOutdated: (message: string) => void;
}) {
  const { api } = useClient();
  const { exit } = useApp();
  const [step, setStep] = useState<Step>({ name: "starting" });
  const [now, setNow] = useState(() => performance.now());
  const attempt = useRef(0);
  const done = useRef(onToken);
  done.current = onToken;
  const outdated = useRef(onOutdated);
  outdated.current = onOutdated;

  const start = useCallback(async () => {
    const id = ++attempt.current;
    setStep({ name: "starting" });
    try {
      const login = await api.deviceStart();
      if (id === attempt.current)
        setStep({ name: "waiting", login, expiresAt: performance.now() + login.expiresIn * 1000 });
    } catch (e) {
      if (id !== attempt.current) return;
      if (isOutdated(e)) outdated.current(e.message);
      else setStep({ name: "failed", message: e instanceof ApiError ? e.message : String(e) });
    }
  }, [api]);

  useEffect(() => {
    start();
    return () => {
      attempt.current++;
    };
  }, [start]);

  // Poll at the interval the server asks for, until it answers with a token or an error.
  const handle = step.name === "waiting" ? step.login.handle : null;
  const firstInterval = step.name === "waiting" ? step.login.interval : 5;
  useEffect(() => {
    if (!handle) return;
    const id = attempt.current;
    let timer: NodeJS.Timeout;
    const poll = async (interval: number) => {
      timer = setTimeout(async () => {
        try {
          const r = await api.devicePoll(handle);
          if (id !== attempt.current) return;
          if (r.status === "ok") done.current(r.token);
          else poll(r.interval);
        } catch (e) {
          if (id !== attempt.current) return;
          // Network hiccup or rate limit: keep trying until the code expires.
          if (e instanceof ApiError && (e.status === 0 || e.status === 429 || e.status >= 500))
            poll(interval);
          else setStep({ name: "failed", message: e instanceof ApiError ? e.message : String(e) });
        }
      }, interval * 1000);
    };
    poll(firstInterval);
    return () => clearTimeout(timer);
  }, [api, handle, firstInterval]);

  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const left = step.name === "waiting" ? Math.max(0, (step.expiresAt - now) / 1000) : 0;
  const expired = step.name === "waiting" && left === 0;

  useKeys({
    o: () => step.name === "waiting" && openBrowser(step.login.verificationUri),
    r: () => step.name !== "starting" && start(),
    q: exit,
  });

  return (
    <Box flexDirection="column">
      <A>{LOGO}</A>
      <Text> </Text>
      <Text>Monte ta boîte de dev. Forme tes juniors, règle tes moulis, livre du code propre.</Text>
      <Text>Le meilleur CA de la saison gagne.</Text>
      <Text> </Text>
      {step.name === "starting" && <T tone="dim">connexion…</T>}
      {step.name === "failed" && (
        <>
          <T tone="bad">{step.message}</T>
          <Text>
            <K k="r" /> recommencer
          </Text>
        </>
      )}
      {step.name === "waiting" && !expired && (
        <>
          <Text bold>Connexion avec ton compte Epitech (Microsoft) :</Text>
          <Text>
            1. ouvre <A bold>{step.login.verificationUri}</A> <K k="o" /> ouvrir le navigateur
          </Text>
          <Text>
            2. entre le code <A bold>{step.login.userCode}</A>
          </Text>
          <T tone="dim">en attente de la connexion… (le code expire dans {formatDuration(left)})</T>
          <T tone="warn">
            Ne donne jamais ce code à quelqu'un et n'entre pas un code reçu par message : il
            connecterait ton compte sur sa machine.
          </T>
        </>
      )}
      {expired && (
        <>
          <T tone="warn">Le code a expiré.</T>
          <Text>
            <K k="r" /> nouveau code
          </Text>
        </>
      )}
      <Text> </Text>
      <T tone="dim">
        Compte Epitech obligatoire. Seul ton identifiant Microsoft anonyme est stocké, jamais ton
        nom ni ton email. Les autres joueurs ne voient que ton pseudo.
      </T>
      <T tone="dim">[q] quitter</T>
    </Box>
  );
}
