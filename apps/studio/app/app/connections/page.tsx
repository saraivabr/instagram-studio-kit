import {
  InstagramConnections,
  type ConnectionFeedback,
} from "@/features/instagram/components/connections";

export const metadata = { title: "Conectar Instagram | Instagram Studio" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  let feedback: ConnectionFeedback = null;
  if (
    params.error === "oauth_denied" ||
    params.error === "access_denied" ||
    params.oauth_denied === "1" ||
    params.oauth_denied === "true"
  ) {
    feedback = "denied";
  } else if (
    params.error !== undefined ||
    params.error_message !== undefined ||
    params.oauth_denied !== undefined
  ) {
    feedback = "failed";
  } else if (params.connected === "instagram") {
    feedback = "connected";
  }
  return <InstagramConnections feedback={feedback} />;
}
