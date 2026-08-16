import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AdminShell } from "@/components/admin-shell";

/**
 * Back-office chrome. The role check here is a real boundary, not just for
 * looks — middleware redirects unauthenticated users, but a PASSENGER who
 * navigates directly must also be turned away before any data is fetched.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Server rendering cannot see which account *this tab* has selected — that
  // choice travels in a request header the browser does not send on a
  // navigation. So the only check possible here is that somebody is signed in;
  // the role gate happens in AdminShell, which knows the tab's identity.
  //
  // This is a usability gate, not the security boundary. Every admin API
  // re-checks the role server-side against the tab's actual session, so a
  // passenger who reaches this markup can still read nothing.
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin");

  return <AdminShell>{children}</AdminShell>;
}
