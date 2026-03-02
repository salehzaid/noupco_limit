"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

export default function ImportRedirect() {
  const params = useParams<{ hospitalId: string }>();
  const router = useRouter();
  useEffect(() => {
    router.replace(`/hospitals/${params.hospitalId}/admin?tab=master-import`);
  }, [params.hospitalId, router]);
  return null;
}
