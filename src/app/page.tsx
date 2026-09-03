import { redirect } from "next/navigation";
export default function Home() {
  redirect("/prototype/support?variant=inbox");
}
