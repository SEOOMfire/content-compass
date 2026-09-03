import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: () => {
    throw redirect({ to: "/jobs" });
  },
  head: () => ({
    meta: [
      { title: "Content-Lokalisierung – Fressnapf/Maxi Zoo" },
      {
        name: "description",
        content:
          "Internes Tool zur SEO-konformen Lokalisierung von Magazin-Inhalten in neue Märkte.",
      },
      { property: "og:title", content: "Content-Lokalisierung – Fressnapf/Maxi Zoo" },
      {
        property: "og:description",
        content: "Internes Tool zur SEO-konformen Lokalisierung von Magazin-Inhalten.",
      },
    ],
  }),
  component: () => null,
});
