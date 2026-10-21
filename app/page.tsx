import { redirect } from "next/navigation";

// Sem site público: a raiz leva ao painel (o proxy manda para o login quem não tem sessão).
export default function Home() {
  redirect("/dashboard");
}
