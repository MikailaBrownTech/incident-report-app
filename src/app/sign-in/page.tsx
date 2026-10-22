import { AuthPage } from "@/components/auth-page";

export default function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  return <AuthPage mode="sign-in" searchParams={searchParams} />;
}
