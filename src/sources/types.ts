export interface PendingEmail {
  sourceId: string;
  messageId: string;
  threadId: string;
  sender: string;
  senderDomain: string;
  subject: string;
  receivedDate: string;
  bodyText: string | null;
  icsAttachments: string[];
  backLink: string;
}

export interface EventSource {
  readonly sourceId: string;
  fetchPending(): Promise<PendingEmail[]>;
  ack(email: PendingEmail): Promise<void>;
}
