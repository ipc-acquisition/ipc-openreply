import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import {
  getRequestIp,
  hashClickIp,
  parseRecipientToken,
} from "@/lib/tracking/server";

type RedirectRouteProps = {
  params: Promise<{ slug: string }>;
};

/**
 * Tracked redirect for both campaign links (TrackedLink) and flow CTA buttons
 * (FlowButton). The two keep separate slug spaces and separate click tables;
 * the `?r=` recipient token makes clicks count once per person in either.
 */
export async function GET(request: NextRequest, { params }: RedirectRouteProps) {
  const { slug } = await params;
  const recipientHash = parseRecipientToken(new URL(request.url).searchParams.get("r"));
  const ipHash = hashClickIp(getRequestIp(request));
  const userAgent = request.headers.get("user-agent");

  const trackedLink = await prisma.trackedLink.findUnique({
    where: { slug },
    select: {
      id: true,
      workspaceId: true,
      automationId: true,
      destinationUrl: true,
      automation: {
        select: {
          instagramAccountId: true,
        },
      },
    },
  });

  if (trackedLink) {
    await prisma.linkClick.create({
      data: {
        workspaceId: trackedLink.workspaceId,
        automationId: trackedLink.automationId,
        instagramAccountId: trackedLink.automation.instagramAccountId,
        trackedLinkId: trackedLink.id,
        ipHash,
        recipientHash,
        userAgent,
        referrer: request.headers.get("referer"),
      },
    });
    return NextResponse.redirect(trackedLink.destinationUrl, { status: 302 });
  }

  const flowButton = await prisma.flowButton.findUnique({
    where: { slug },
    select: {
      id: true,
      url: true,
      step: { select: { flow: { select: { workspaceId: true } } } },
    },
  });

  if (flowButton) {
    await prisma.flowClick.create({
      data: {
        workspaceId: flowButton.step.flow.workspaceId,
        buttonId: flowButton.id,
        recipientHash,
        ipHash,
        userAgent,
      },
    });
    return NextResponse.redirect(flowButton.url, { status: 302 });
  }

  return NextResponse.redirect(new URL("/", request.url), { status: 302 });
}
