import { redirect } from "next/navigation";

// No public site: the root goes to the dashboard (the proxy sends signed-out visitors to login).
export default function Home() {
  redirect("/dashboard");
}
