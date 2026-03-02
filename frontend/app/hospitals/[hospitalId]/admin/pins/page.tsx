"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

export default function PinsRedirect() {
  const params = useParams<{ hospitalId: string }>();
  const router = useRouter();
  useEffect(() => {
    router.replace(`/hospitals/${params.hospitalId}/admin?tab=pins`);
  }, [params.hospitalId, router]);
  return null;
}
