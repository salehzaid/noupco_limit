import { redirect } from "next/navigation";

export default function LimitsPage() {
  redirect("/hospitals/1/departments");
}
