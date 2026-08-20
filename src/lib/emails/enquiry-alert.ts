import { emailLayout, emailText } from "./layout";

/**
 * The quote request, as it reaches the owner.
 *
 * These were going through alertOwner, which exists for the two failures in
 * this product worth waking somebody for. That channel is plain text and
 * subjects itself "Homewick needs a look", which is exactly wrong for a lead:
 * it reads as an incident, and a wall of unformatted lines is hard to scan on
 * a phone, which is where it will actually be read.
 *
 * A quote request is good news and needs the same treatment as any other
 * message this business sends. Same layout, same brand, details in a table
 * rather than a paragraph.
 */
export function enquiryAlertEmail(input: {
  name: string;
  email: string;
  phone: string;
  address?: string | null;
  squareFeet?: number | null;
  hasPets: boolean;
  serviceType: string;
  frequency?: string | null;
  message?: string | null;
}): { subject: string; text: string; html: string } {
  const service =
    input.serviceType === "not_sure"
      ? "Not sure yet"
      : input.serviceType.replace("_", " ").replace(/^./, (c) => c.toUpperCase());

  // Only what they actually told us. A row reading "not given" is noise on a
  // screen you are scanning at a traffic light.
  const rows = [
    { label: "Phone", value: input.phone },
    { label: "Email", value: input.email },
    ...(input.address ? [{ label: "Address", value: input.address }] : []),
    ...(input.squareFeet
      ? [{ label: "Size", value: `about ${input.squareFeet.toLocaleString()} sq ft` }]
      : []),
    { label: "Service", value: service },
    ...(input.frequency ? [{ label: "How often", value: input.frequency }] : []),
    ...(input.hasPets ? [{ label: "Pets", value: "Yes" }] : []),
  ];

  const opts = {
    heading: `${input.name} wants a quote`,
    intro: "A house quote request just came in through the site.",
    rows,
    // Two paragraphs rather than one with a <br>. The plain-text version
    // strips tags, so a <br> between the label and the message left them
    // running together as "What they saidTwo storey".
    body: input.message
      ? [`<strong>What they said</strong>`, input.message]
      : [],
    // Deliberately no deep link into admin. Admin lives on its own hostname,
    // which this file has no reliable way to know, and a link that lands on a
    // 404 in a hurry is worse than no link at all.
    footerNote:
      "Quote them on a call, then create the booking under New booking in admin.",
    internal: true,
  };

  return {
    // No "needs a look" prefix. This is work arriving, not something broken,
    // and the name is what makes it findable later in a full inbox.
    subject: `Quote request from ${input.name}`,
    html: emailLayout(opts),
    text: emailText(opts),
  };
}
