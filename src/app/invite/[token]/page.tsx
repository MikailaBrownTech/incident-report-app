import Link from "next/link";
import { Fog } from "@/components/fog";
import { primaryButton } from "@/components/form";
import { AcceptInviteButton, SwitchAccountButton } from "@/components/invite-actions";
import { SkinToggle } from "@/components/skin-toggle";
import { getCopy } from "@/copy";
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
    const message = {
      not_found: t.invite.notFound,
      expired: t.invite.expired,
      revoked: t.invite.revoked,
      used: t.invite.used,
    }[found.status];
    body = (
      <>
        <p role="alert" className="text-lg">
          {message}
        </p>
        <Link href={session ? "/app" : "/sign-in"} className={`${primaryButton} inline-block self-start`}>
          {session ? t.invite.backHome : t.nav.signIn}
        </Link>
      </>
    );
  } else {
    const roleName = t.workspaceRole[found.invite.role];
    const heading = (
      <>
        <h1 className="flicker text-3xl font-bold">{t.invite.heading(found.workspace.name)}</h1>
        <p className="text-muted">{t.invite.asRole(roleName)}</p>
      </>
    );
    if (!session) {
      body = (
        <>
          {heading}
          <Link
            href={`/sign-in?callbackUrl=${encodeURIComponent(`/invite/${token}`)}`}
            className={`${primaryButton} inline-block self-start`}
          >
            {t.invite.signInToAccept}
          </Link>
        </>
      );
    } else if (session.user.email.toLowerCase() !== found.invite.email.toLowerCase()) {
      body = (
        <>
          {heading}
          <div role="alert" className="space-y-1 rounded border border-danger p-4">
            <p className="font-semibold text-danger">{t.invite.mismatchHeading}</p>
            <p>{t.invite.mismatchBody(found.invite.email, session.user.email)}</p>
          </div>
          <div>
            <SwitchAccountButton token={token} />
          </div>
        </>
      );
    } else {
      body = (
        <>
          {heading}
          <div>
            <AcceptInviteButton token={token} />
          </div>
        </>
      );
    }
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
