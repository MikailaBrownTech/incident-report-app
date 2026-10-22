import { redirect } from "next/navigation";

export default async function WorkspaceIndex({ params }: PageProps<"/app/[slug]">) {
  const { slug } = await params;
  redirect(`/app/${slug}/dashboard`);
}
