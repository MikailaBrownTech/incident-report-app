import { AuthPage } from "@/components/auth-page";

export default function SignUpPage({ searchParams }: PageProps<"/sign-up">) {
  return <AuthPage mode="sign-up" searchParams={searchParams} />;
}
