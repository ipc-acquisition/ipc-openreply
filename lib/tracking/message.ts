export interface MessageTrackedLink {
  slug: string;
  destinationUrl: string;
}

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/i;

function trimTrailingPunctuation(url: string) {
  return url.replace(/[.,!?;:]+$/, "");
}

export function extractFirstUrl(message: string): string | null {
  const match = message.match(URL_PATTERN);
  if (!match) return null;

  try {
    const url = trimTrailingPunctuation(match[0]);
    return new URL(url).toString();
  } catch {
    return null;
  }
}

export function replaceUrlWithTrackedPlaceholder(
  message: string,
  destinationUrl: string | null | undefined
) {
  if (!destinationUrl) return message;
  if (message.includes(destinationUrl)) {
    return message.replace(destinationUrl, "{link}");
  }

  const withoutTrailingSlash = destinationUrl.replace(/\/$/, "");
  return message.replace(withoutTrailingSlash, "{link}");
}

/**
 * Personalize {username} and strip the {link} token — used when the link is
 * delivered as a separate button rather than inline in the message text.
 */
export function renderMessageWithoutLink({
  message,
  commenterName,
}: {
  message: string;
  commenterName?: string | null;
}) {
  return message
    .replace(/\{username\}/gi, commenterName ?? "there")
    .replace(/\s*\{link\}\s*/gi, " ")
    .trim();
}

export function buildTrackedUrl(
  slug: string,
  baseUrl?: string,
  recipientToken?: string
) {
  const resolvedBaseUrl =
    baseUrl ??
    (typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXTAUTH_URL ?? "http://localhost:3000");

  const url = `${resolvedBaseUrl.replace(/\/$/, "")}/r/${slug}`;
  return recipientToken ? `${url}?r=${recipientToken}` : url;
}

export function renderMessageWithTracking({
  message,
  commenterName,
  trackedLinks,
  baseUrl,
  recipientToken,
}: {
  message: string;
  commenterName?: string | null;
  trackedLinks?: MessageTrackedLink[];
  baseUrl?: string;
  recipientToken?: string;
}) {
  let rendered = message.replace(/\{username\}/gi, commenterName ?? "there");
  const primaryLink = trackedLinks?.[0];

  if (!primaryLink) return rendered;

  const trackedUrl = buildTrackedUrl(primaryLink.slug, baseUrl, recipientToken);

  if (/\{link\}/i.test(rendered)) {
    return rendered.replace(/\{link\}/gi, trackedUrl);
  }

  if (rendered.includes(primaryLink.destinationUrl)) {
    rendered = rendered.replaceAll(primaryLink.destinationUrl, trackedUrl);
  } else {
    const withoutTrailingSlash = primaryLink.destinationUrl.replace(/\/$/, "");
    rendered = rendered.replaceAll(withoutTrailingSlash, trackedUrl);
  }

  return rendered;
}

/**
 * The link-in-text format (Automation.linkInText): every tracked link goes in
 * the message itself, where Messenger makes it clickable, instead of in
 * buttons. The first link takes the place of {link} (or of its destination URL
 * pasted in the text); without either it goes on a line of its own at the
 * end, so it is never dropped. Further links follow, one per line, after their
 * label when they have one.
 */
export function renderMessageWithInlineLinks({
  message,
  commenterName,
  trackedLinks,
  baseUrl,
  recipientToken,
}: {
  message: string;
  commenterName?: string | null;
  trackedLinks: Array<MessageTrackedLink & { label?: string | null }>;
  baseUrl?: string;
  recipientToken?: string;
}) {
  const rendered = renderMessageWithTracking({
    message,
    commenterName,
    trackedLinks,
    baseUrl,
    recipientToken,
  }).trim();
  const [primary, ...extra] = trackedLinks;
  if (!primary) return rendered;

  const lines = [rendered];
  const primaryUrl = buildTrackedUrl(primary.slug, baseUrl, recipientToken);
  if (!rendered.includes(primaryUrl)) lines.push(primaryUrl);
  for (const link of extra) {
    const url = buildTrackedUrl(link.slug, baseUrl, recipientToken);
    lines.push(link.label ? `${link.label}: ${url}` : url);
  }
  return lines.filter(Boolean).join("\n");
}
