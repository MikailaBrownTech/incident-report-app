import Link from "next/link";
import { Fog } from "@/components/fog";
import { primaryButton } from "@/components/form";
import { SkinToggle } from "@/components/skin-toggle";
import { getCopy } from "@/copy";
import { acceptInviteAction } from "@/features/workspaces/actions";
import { getSkin } from "@/lib/skin";
import { getSession } from "@/server/auth/session";
import { findInviteByToken } from "@/server/db/root";

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const skin = await getSkin();
  const t = getCopy(skin);
  const [found, session] = await Promise.all([findInviteByToken(token), getSession()]);

  let body;
  if (found.status !== "ok") {
    const message = { not_found: t.invite.notFound, expired: t.invite.expired, used: t.invite.used }[found.status];
    body = <p role="alert">{message}</p>;
  } else {
    const roleName = t.workspaceRole[found.invite.role];
    body = (
      <>
        <h1 className="flicker text-3xl font-bold">{t.invite.heading(found.workspace.name)}</h1>
        <p className="text-muted">{t.invite.asRole(roleName)}</p>
        {!session ? (
          <Link
            href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
            className={`${primaryButton} inline-block self-start`}
          >
            {t.invite.signInToAccept}
          </Link>
        ) : session.user.email.toLowerCase() !== found.invite.email.toLowerCase() ? (
          <p role="alert" className="text-danger">
            {t.invite.wrongAccount(found.invite.email)}
          </p>
        ) : (
          <form action={acceptInviteAction.bind(null, token)}>
            <button type="submit" className={primaryButton}>
              {t.invite.accept}
            </button>
          </form>
        )}
      </>
    );
  }

  return (
    <main className="relative isolate flex flex-1 flex-col">
      <Fog />
      <header className="relative z-10 flex items-center justify-between p-6">
        <span className="flicker text-xl font-bold">{t.brand.name}</span>
        <SkinToggle skin={skin} />
      </header>
      <section className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 p-6">
        {body}
      </section>
    </main>
  );
}
