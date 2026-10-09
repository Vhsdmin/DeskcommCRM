import { isDevelopmentCsPreview } from "@/lib/customer-success/preview";
import { notFound } from "next/navigation";
import { CustomerSuccessWorkspace } from "@/components/customer-success/Workspace";
export const metadata = {
  title: "VendePay · Prévia de Customer Success",
  robots: { index: false, follow: false },
};

export default function Page() {
  if (!isDevelopmentCsPreview("/cs-preview", process.env.NODE_ENV)) notFound();
  return <CustomerSuccessWorkspace />;
}
