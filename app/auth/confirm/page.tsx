import LinkHandler from "../link-handler";

/** Supabase's default emailed-link path: /auth/confirm?token_hash=...&type=email */
export default function AuthConfirm() {
  return <LinkHandler />;
}
