import type { Metadata } from "next";
import { NpsPublico } from "./_client";
export const metadata: Metadata = {
  title: "Pesquisa NPS",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default function NpsPage() {
  return <NpsPublico />;
}
