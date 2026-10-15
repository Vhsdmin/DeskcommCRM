import type { Metadata } from "next";
import { ContactsListClient } from "./_client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Clientes · VendePay" };

export default function ContactsPage() {
  return <ContactsListClient />;
}
