import type { FastifyReply } from "fastify";

/** API error codes with their French message for the clients. Game rule errors come from core. */
export const API_ERRORS = {
  unauthorized: "Connecte-toi pour jouer.",
  pseudo_required: "Choisis un pseudo pour jouer.",
  pseudo_taken: "Ce pseudo est déjà pris.",
  invalid_request: "Requête invalide.",
  rate_limited: "Trop de requêtes, réessaie dans un instant.",
  replay: "Cette action a déjà été reçue.",
  auth_unavailable: "Connexion indisponible pour le moment.",
  login_expired: "La connexion a expiré, recommence.",
  login_denied: "Connexion refusée.",
  banned: "Ce compte a été suspendu.",
  not_found: "Introuvable.",
  internal: "Erreur du serveur.",
} as const;

export type ApiError = keyof typeof API_ERRORS;

export function sendError(
  reply: FastifyReply,
  status: number,
  error: ApiError,
  extra: object = {},
): FastifyReply {
  return reply.code(status).send({ error, message: API_ERRORS[error], ...extra });
}
