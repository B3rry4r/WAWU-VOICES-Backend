/** The signed-in person on a request: the verified WAWU ID claims VOICES uses. */
export interface VoicesUser {
  /** WAWU ID user id (the `sub` claim). Every VOICES row keys on this. */
  sub: string;
  email: string | null;
  phone?: string;
  firstName?: string;
  lastName?: string;
  iat: number;
  exp: number;
}

/** What `req.user` is on a route behind OptionalAuthGuard: a user, or nobody. */
export type MaybeVoicesUser = VoicesUser | undefined;
