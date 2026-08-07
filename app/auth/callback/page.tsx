import LinkHandler from "../link-handler";

/** Alias for /auth/confirm in case the email template uses /auth/callback. */
export default function AuthCallback() {
  return <LinkHandler />;
}
